"""
FastAPI Server for E-KYC Face ID & Anti-Spoofing Pipeline.
Hỗ trợ tiếp nhận ảnh từ Server Node.js và Web Client qua:
1. Multipart Form-Data (File upload trực tiếp)
2. JSON payload (Base64 data URI hoặc raw Base64)

Xử lý đầy đủ quy trình:
- YOLO Face Detection
- MediaPipe 478 Landmarks & 3D Pose Validation (Yaw/Pitch/Roll)
- Face Alignment & 224x224 Crop
- Ensemble Anti-Spoofing (YOLO_4 + RF-DETR Small) với Soft Voting & Spoof Veto
- Active Liveness Validation (Blink, Head Movement)
- Trả về JSON chuẩn hóa cho Node.js kèm ảnh Crop khuôn mặt và Annotated HUD
"""

import os
import sys
import time
import math
from contextlib import asynccontextmanager
from typing import Optional, Union, Dict, Any, Tuple

import cv2
import numpy as np
import torch
from fastapi import FastAPI, File, UploadFile, Form, HTTPException, Request, Depends, status, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles

# Setup paths
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(CURRENT_DIR)
STATIC_DIR = os.path.join(CURRENT_DIR, "static")

if CURRENT_DIR not in sys.path:
    sys.path.insert(0, CURRENT_DIR)
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

try:
    from server_module.config import NODEJS_WEBHOOK_URL, NODEJS_WEBHOOK_TIMEOUT
except ImportError:
    NODEJS_WEBHOOK_URL = "http://127.0.0.1:3000/api/ekyc/result"
    NODEJS_WEBHOOK_TIMEOUT = 5.0

try:
    from server_module.pipeline_server import EKYCPipelineServer
    from server_module.utils import (
        load_image,
        image_to_base64,
        calculate_iou,
        draw_landmarks,
        get_default_oval_params,
        get_oval_masked_frame,
        draw_oval_face_guide,
        create_pipeline_result_dashboard,
        create_side_by_side_result,
        json_serialize_helper
    )
    from server_module.schemas import (
        VerifyJsonRequest,
        VerifyResponse,
        PoseValidateJsonRequest,
        PoseValidateResponse,
        AntiSpoofJsonRequest,
        AntiSpoofResponse,
        HealthResponse
    )
except ImportError:
    from pipeline_server import EKYCPipelineServer
    from utils import (
        load_image,
        image_to_base64,
        calculate_iou,
        draw_landmarks,
        get_default_oval_params,
        get_oval_masked_frame,
        draw_oval_face_guide,
        create_pipeline_result_dashboard,
        create_side_by_side_result,
        json_serialize_helper
    )
    from schemas import (
        VerifyJsonRequest,
        VerifyResponse,
        PoseValidateJsonRequest,
        PoseValidateResponse,
        AntiSpoofJsonRequest,
        AntiSpoofResponse,
        HealthResponse
    )


# =============================================================================
# LIFESPAN & APP CONFIGURATION
# =============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Quản lý vòng đời ứng dụng: Tải trước toàn bộ mô hình AI vào RAM/VRAM."""
    print("=" * 70)
    print(" [FASTAPI E-KYC SERVER] Đang khởi tạo và nạp trước các mô hình AI...")
    device_name = "cuda" if torch.cuda.is_available() else "cpu"
    print(f" [DEVICE INFO] Sử dụng thiết bị tính toán: {device_name.upper()}")
    print("=" * 70)
    
    # Khởi tạo pipeline server một lần duy nhất
    app.state.pipeline = EKYCPipelineServer(lazy_load=False)
    app.state.start_time = time.time()
    print("\n [FASTAPI E-KYC SERVER] Sẵn sàng phục vụ kết nối từ Node.js và Web Client!\n")
    
    yield
    
    print("\n [FASTAPI E-KYC SERVER] Đang tắt máy chủ...")


app = FastAPI(
    title="E-KYC Face Verification & Anti-Spoofing AI Server",
    description=(
        "AI Microservice cung cấp API quét và xác thực khuôn mặt, kiểm tra tư thế 3D, "
        "và phát hiện giả mạo Ensemble (YOLO_4 + RF-DETR Small) cho Backend Node.js & Web Client."
    ),
    version="2.0.0",
    lifespan=lifespan
)

# Kích hoạt CORS Middleware cho phép mọi domain kết nối (Node.js backend, React, Vue, Web Client)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Phục vụ thư mục static nếu tồn tại
if os.path.exists(STATIC_DIR):
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def _extract_crop_and_annotation(
    pipeline: EKYCPipelineServer,
    frame: np.ndarray,
    report: Dict[str, Any],
    return_crop: bool = True,
    return_annotated: bool = True
) -> Tuple[Optional[str], Optional[str]]:
    """Tạo ảnh crop 224x224 và ảnh annotated HUD từ kết quả verify."""
    crop_b64 = None
    annotated_b64 = None
    h_f, w_f = frame.shape[:2]

    primary_face = report["face_detection"].get("primary_face")
    if return_crop and primary_face and primary_face.get("bbox"):
        try:
            face_crop = pipeline.aligner.crop_face(
                frame,
                bbox=primary_face["bbox"],
                padding=25,
                output_size=(224, 224),
                mode="bbox"
            )
            if face_crop is not None and face_crop.size > 0:
                crop_b64 = image_to_base64(face_crop)
        except Exception as e:
            print(f"[WARN] Không thể crop khuôn mặt 224x224: {e}")

    if return_annotated:
        try:
            # Lấy thông tin Oval và làm mờ bối cảnh ngoại vi
            oval_info = report.get("oval_guide") or {}
            oval_center = tuple(oval_info.get("center") or (w_f // 2, int(h_f * 0.505)))
            oval_axes = tuple(oval_info.get("axes") or (int(h_f * 0.38 * 0.65), int(h_f * 0.38)))
            final_pass = report["final_decision"]["approved"]

            # 1. Làm mờ bối cảnh ngoại vi trừ khung Oval (Bokeh Effect)
            clean_img = get_oval_masked_frame(frame, oval_center, oval_axes, blur_ksize=45, dim_factor=0.35)
            guide_color = (0, 255, 127) if final_pass else (0, 0, 255)
            clean_img = draw_oval_face_guide(
                clean_img,
                center=oval_center,
                axes=oval_axes,
                is_aligned=final_pass,
                is_detected=bool(primary_face),
                color=guide_color
            )

            # 2. Vẽ bounding box khuôn mặt
            if primary_face and primary_face.get("bbox"):
                bx1, by1, bx2, by2 = primary_face["bbox"]
                cv2.rectangle(clean_img, (bx1, by1), (bx2, by2), (0, 255, 0), 2)
                cv2.putText(clean_img, "PRIMARY FACE", (bx1, max(18, by1 - 6)),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 255, 0), 1, cv2.LINE_AA)

            # 3. Vẽ landmarks nếu có
            landmarks = pipeline.landmark_detector.detect(frame)
            if landmarks:
                clean_img = draw_landmarks(clean_img, landmarks)

            # 4. Vẽ Ensemble spoof detections
            ens_dets = report["ensemble_anti_spoof"].get("all_ensemble_detections", [])
            for sd in ens_dets:
                sx1, sy1, sx2, sy2 = sd["bbox"]
                if not sd.get("both_detected", False):
                    scol = (0, 165, 255)
                    tag = f"1-MODEL: {sd['confidence']*100:.1f}%"
                elif sd["is_real"]:
                    scol = (0, 255, 0)
                    tag = f"REAL {sd['confidence']*100:.1f}%"
                else:
                    scol = (0, 0, 255)
                    tag = f"SPOOF {sd['confidence']*100:.1f}%"

                cv2.rectangle(clean_img, (sx1, sy1), (sx2, sy2), scol, 2)
                cv2.putText(clean_img, tag, (sx1, max(20, sy1 - 8)),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.45, scol, 1, cv2.LINE_AA)

            # 5. Badge verdict góc phải trên
            verdict_badge = "eKYC: APPROVED" if final_pass else "eKYC: REJECTED"
            badge_col = (0, 255, 0) if final_pass else (0, 0, 255)
            badge_w = 230
            cv2.rectangle(clean_img, (w_f - badge_w - 15, 12), (w_f - 15, 52), (15, 18, 24), -1)
            cv2.rectangle(clean_img, (w_f - badge_w - 15, 12), (w_f - 15, 52), badge_col, 2)
            cv2.putText(clean_img, verdict_badge, (w_f - badge_w - 2, 38),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.58, badge_col, 2, cv2.LINE_AA)

            annotated_b64 = image_to_base64(clean_img)

            # 6. Tạo ảnh Dual Window (Side-by-Side) chuẩn test_pipeline_ensemble_full.py
            try:
                face_crop_arr = None
                if primary_face and primary_face.get("bbox"):
                    face_crop_arr = pipeline.aligner.crop_face(
                        frame, bbox=primary_face["bbox"], padding=25, output_size=(224, 224), mode="bbox"
                    )

                dashboard_img = create_pipeline_result_dashboard(
                    img_idx=report.get("image_id", "1"),
                    face_info=primary_face,
                    num_faces=report["face_detection"].get("num_faces", 1),
                    pose_info=report.get("pose_3d"),
                    pose_valid=report["criteria"].get("pose_valid", False),
                    anti_spoof_info=report.get("ensemble_anti_spoof"),
                    spoof_iou=0.85,
                    blink_passed=report["criteria"].get("blink_passed", False),
                    blink_count=report["active_liveness"].get("blink_count", 0),
                    head_movement_passed=report["criteria"].get("head_movement_passed", False),
                    head_action_name=report["active_liveness"].get("head_action", "NONE"),
                    final_pass=final_pass,
                    reasons=report["final_decision"].get("reasons", []),
                    face_crop=face_crop_arr,
                    target_height=h_f
                )
                side_by_side = create_side_by_side_result(clean_img, dashboard_img)
                dual_b64 = image_to_base64(side_by_side, quality=85)
            except Exception as e:
                print(f"[WARN] Không thể tạo Side-by-Side Dual Window: {e}")
                dual_b64 = None
        except Exception as e:
            print(f"[WARN] Không thể vẽ annotated image: {e}")
            dual_b64 = None
    else:
        dual_b64 = None

    return crop_b64, annotated_b64, dual_b64


# =============================================================================
# API ROUTES
# =============================================================================

@app.get("/", response_class=HTMLResponse, summary="Giao diện Web Xác Thực eKYC")
async def serve_home_ui():
    """Phục vụ trang Web HTML kiểm tra và xác thực khuôn mặt trực quan."""
    index_html_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_html_path):
        with open(index_html_path, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse(
        content="<h2>E-KYC FastAPI Server is running. Static index.html not found yet.</h2>",
        status_code=200
    )


@app.get("/demo", response_class=HTMLResponse, summary="Đường dẫn thay thế tới Giao diện Web")
async def serve_demo_ui():
    return await serve_home_ui()


@app.get("/simple", response_class=HTMLResponse, summary="Giao diện Tối giản eKYC (Chỉ Khung Oval & Hướng dẫn)")
async def serve_simple_ui():
    """Phục vụ trang Web eKYC tối giản: chỉ gồm khung oval và hướng dẫn từng bước."""
    simple_html_path = os.path.join(STATIC_DIR, "simple.html")
    if os.path.exists(simple_html_path):
        with open(simple_html_path, "r", encoding="utf-8") as f:
            return HTMLResponse(content=f.read())
    return HTMLResponse(
        content="<h2>Static simple.html not found yet.</h2>",
        status_code=404
    )


@app.get("/kiosk", response_class=HTMLResponse, summary="Đường dẫn thay thế tới Giao diện Tối giản")
async def serve_kiosk_ui():
    return await serve_simple_ui()


@app.get("/api/v1/health", response_model=HealthResponse, summary="Kiểm tra trạng thái máy chủ AI")
async def health_check(request: Request):
    """Endpoint Healthcheck để Node.js Backend giám sát trạng thái hoạt động của AI Server."""
    pipeline = getattr(request.app.state, "pipeline", None)
    models_ready = bool(pipeline and pipeline.detector is not None)
    device = "cuda" if torch.cuda.is_available() else "cpu"

    return HealthResponse(
        status="healthy" if models_ready else "initializing",
        engine="E-KYC Server Module (Ensemble Edition: YOLO_4 + RF-DETR Small)",
        models_loaded=models_ready,
        device=device,
        version=app.version
    )


# -----------------------------------------------------------------------------
# 1. CORE PIPELINE: POST /api/v1/verify
# (Nhận cả Multipart Form-Data từ Node.js lẫn JSON Base64 từ Web/Client)
# -----------------------------------------------------------------------------
@app.post(
    "/api/v1/verify",
    response_model=VerifyResponse,
    summary="Xác thực eKYC toàn diện (Full Verify Pipeline)"
)
async def verify_face(
    request: Request,
    # Hỗ trợ nhận file trực tiếp qua Multipart Form-Data (Khuyến nghị cho Node.js Multer/FormData)
    file: Optional[UploadFile] = File(None, description="File ảnh khuôn mặt (JPG/PNG)"),
    img_id: Optional[str] = Form("1", description="ID lượt kiểm tra / transaction ID"),
    user_id: Optional[str] = Form(None, description="Mã định danh người dùng"),
    blink_passed: Optional[bool] = Form(True, description="Trạng thái chớp mắt đạt"),
    blink_count: Optional[int] = Form(1, description="Số lần chớp mắt"),
    head_passed: Optional[bool] = Form(True, description="Trạng thái quay đầu đạt"),
    head_action: Optional[str] = Form("TURN_LEFT", description="Hành động quay đầu"),
    session_id: Optional[str] = Form(None, description="Mã phiên liveness đối chiếu sinh trắc học"),
    blink_file: Optional[UploadFile] = File(None, description="Ảnh frame chớp mắt thành công"),
    head_file: Optional[UploadFile] = File(None, description="Ảnh frame quay đầu thành công"),
    return_annotated_image: Optional[bool] = Form(True, description="Trả về ảnh vẽ HUD Base64"),
    return_crop_image: Optional[bool] = Form(True, description="Trả về ảnh crop 224x224 Base64"),
    apply_oval_mask: Optional[bool] = Form(True, description="Làm mờ bối cảnh ngoại vi trừ khung Oval"),
    output_dir: Optional[str] = Form(None, description="Thư mục lưu artifacts (nếu muốn)")
):
    """
    Xác thực khuôn mặt toàn diện eKYC theo 8 tiêu chí chuẩn ngân hàng:
    1. Phát hiện khuôn mặt (YOLO Face)
    2. Một người duy nhất trong khung hình (Single Person Strict Enforcement)
    3. Tư thế 3D Pose chuẩn (Yaw, Pitch, Roll)
    4. Chống giả mạo Ensemble (YOLO_4 + RF-DETR Small)
    5. Cả 2 mô hình đồng thuận nhận diện (Dual-Model Agreement)
    6. Hoàn thành kiểm tra chớp mắt (Blink Liveness)
    7. Hoàn thành kiểm tra quay đầu (Head Movement)
    8. Xác thực cùng 1 người giữa các bước (Chống tráo đổi người / Face Swap)
    """
    t_start = time.time()
    pipeline: EKYCPipelineServer = request.app.state.pipeline

    # 1. Trích xuất dữ liệu ảnh từ Multipart hoặc JSON
    image_bytes = None
    blink_bytes = None
    head_bytes = None

    if file is not None:
        image_bytes = await file.read()
        if blink_file is not None:
            blink_bytes = await blink_file.read()
        if head_file is not None:
            head_bytes = await head_file.read()
    else:
        # Kiểm tra xem có gửi JSON Body không
        try:
            body = await request.json()
            json_req = VerifyJsonRequest(**body)
            image_bytes = json_req.image_base64
            img_id = json_req.img_id or "1"
            user_id = json_req.user_id
            blink_passed = json_req.blink_passed
            blink_count = json_req.blink_count
            head_passed = json_req.head_passed
            head_action = json_req.head_action
            session_id = getattr(json_req, "session_id", None) or session_id
            blink_bytes = getattr(json_req, "blink_image_base64", None)
            head_bytes = getattr(json_req, "head_image_base64", None)
            return_annotated_image = json_req.return_annotated_image
            return_crop_image = json_req.return_crop_image
            apply_oval_mask = getattr(json_req, "apply_oval_mask", True)
            output_dir = json_req.output_dir
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Yêu cầu cung cấp file ảnh qua Multipart ('file') hoặc qua JSON ('image_base64')."
            )

    if not image_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Dữ liệu ảnh rỗng hoặc không hợp lệ."
        )

    # 2. Đọc và nạp ảnh vào numpy BGR
    try:
        frame = load_image(image_bytes)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Không thể giải mã hình ảnh: {str(e)}"
        )

    # 3. Thực thi Full Verify Pipeline
    try:
        report = pipeline.full_verify(
            image_input=frame,
            img_id=img_id,
            blink_passed=bool(blink_passed),
            blink_count=int(blink_count),
            head_movement_passed=bool(head_passed),
            head_action_name=str(head_action),
            output_dir=output_dir,
            save_visuals=bool(output_dir is not None),
            apply_oval_mask=bool(apply_oval_mask),
            session_id=session_id,
            blink_frame_input=blink_bytes,
            head_frame_input=head_bytes
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Lỗi trong quá trình suy luận mô hình AI: {str(e)}"
        )

    # 4. Trích xuất Crop 224x224, Annotated Image và Dual Window Image Base64 để trả về trực tiếp
    crop_b64, annotated_b64, dual_b64 = _extract_crop_and_annotation(
        pipeline=pipeline,
        frame=frame,
        report=report,
        return_crop=return_crop_image,
        return_annotated=return_annotated_image
    )

    t_total = (time.time() - t_start) * 1000

    # 5. Đóng gói kết quả chuẩn hóa cho Node.js
    ens_info = report["ensemble_anti_spoof"]
    final_dec = report["final_decision"]

    response_data = VerifyResponse(
        success=True,
        image_id=str(report.get("image_id", img_id)),
        timestamp=report.get("timestamp", time.strftime("%Y-%m-%d %H:%M:%S")),
        approved=final_dec["approved"],
        verdict=final_dec["verdict"],
        is_real=ens_info["is_real"],
        confidence=ens_info["confidence"],
        reasons=final_dec.get("reasons", []),
        criteria=report["criteria"],
        face_detection=report["face_detection"],
        pose_3d=report["pose_3d"],
        ensemble_anti_spoof=ens_info,
        active_liveness=report["active_liveness"],
        crop_face_base64=crop_b64,
        annotated_image_base64=annotated_b64,
        dual_window_image_base64=dual_b64,
        oval_guide=report.get("oval_guide"),
        processing_time_ms=round(t_total, 2)
    )

    return response_data


# -----------------------------------------------------------------------------
# 2. PRE-CAPTURE CHECK: POST /api/v1/validate-pose
# -----------------------------------------------------------------------------
@app.post(
    "/api/v1/validate-pose",
    response_model=PoseValidateResponse,
    summary="Kiểm tra tư thế khuôn mặt & khoảng cách (Pre-capture Check)"
)
async def validate_face_pose(
    request: Request,
    file: Optional[UploadFile] = File(None, description="File ảnh")
):
    """Dành cho Node.js / Web Client kiểm tra góc quay mặt & khoảng cách trước khi chụp chính thức."""
    t_start = time.time()
    pipeline: EKYCPipelineServer = request.app.state.pipeline

    image_input = None
    if file is not None:
        image_input = await file.read()
    else:
        try:
            body = await request.json()
            image_input = body.get("image_base64")
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Vui lòng cung cấp file ảnh hoặc trường 'image_base64'."
            )

    if not image_input:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Dữ liệu ảnh rỗng."
        )

    try:
        res = pipeline.validate_pose(image_input)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Lỗi kiểm tra tư thế: {str(e)}"
        )

    t_total = (time.time() - t_start) * 1000

    return PoseValidateResponse(
        success=True,
        has_face=res["has_face"],
        num_faces=res.get("num_faces", 1),
        is_valid=res["is_valid"],
        face_in_oval=res.get("face_in_oval", False),
        fit_oval=res.get("fit_oval", False),
        ratio_to_oval=res.get("ratio_to_oval", 0.0),
        is_aligned_good=res.get("is_aligned_good", False),
        is_occluded=res.get("is_occluded", False),
        occlusion_reason=res.get("occlusion_reason", ""),
        face_size_h=res["face_size_h"],
        is_too_far=res["is_too_far"],
        is_too_close=res.get("is_too_close", False),
        is_off_center=res.get("is_off_center", False),
        off_center_hint=res.get("off_center_hint", ""),
        oval_guide=res.get("oval_guide"),
        pose=res["pose"],
        message=res["message"],
        guide=res["guide"],
        processing_time_ms=round(t_total, 2)
    )


# -----------------------------------------------------------------------------
# 3. DEDICATED ANTI-SPOOF: POST /api/v1/check-antispoof
# -----------------------------------------------------------------------------
@app.post(
    "/api/v1/check-antispoof",
    response_model=AntiSpoofResponse,
    summary="Kiểm tra chống giả mạo độc lập (Ensemble Anti-Spoofing)"
)
async def check_anti_spoof(
    request: Request,
    file: Optional[UploadFile] = File(None, description="File ảnh"),
    conf_threshold: Optional[float] = Form(0.30, description="Ngưỡng confidence tối thiểu")
):
    """Kiểm tra chuyên sâu chống giả mạo bằng cụm Ensemble (YOLO_4 + RF-DETR Small)."""
    t_start = time.time()
    pipeline: EKYCPipelineServer = request.app.state.pipeline

    image_input = None
    if file is not None:
        image_input = await file.read()
    else:
        try:
            body = await request.json()
            image_input = body.get("image_base64")
            conf_threshold = body.get("conf_threshold", 0.30)
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Vui lòng cung cấp file ảnh hoặc trường 'image_base64'."
            )

    if not image_input:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Dữ liệu ảnh rỗng."
        )

    try:
        res = pipeline.check_antispoof(image_input, conf_threshold=conf_threshold)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Lỗi kiểm tra chống giả mạo: {str(e)}"
        )

    t_total = (time.time() - t_start) * 1000

    return AntiSpoofResponse(
        success=True,
        has_face=res["has_face"],
        num_faces=res["num_faces"],
        is_real=res["is_real"],
        label=res["label"],
        confidence=res["confidence"],
        primary_spoof_iou=res.get("primary_spoof_iou", 0.0),
        primary_face=res.get("primary_face"),
        crop_face_base64=res.get("crop_face_base64"),
        ensemble_detail=res.get("ensemble_detail"),
        all_ensemble_detections=res.get("all_ensemble_detections", []),
        processing_time_ms=round(t_total, 2)
    )


# -----------------------------------------------------------------------------
# 4. ACTIVE LIVENESS CHALLENGES: BLINK & HEAD MOVEMENT
# -----------------------------------------------------------------------------
def _parse_bool_param(val) -> bool:
    if isinstance(val, bool):
        return val
    if isinstance(val, (int, float)):
        return val != 0
    if isinstance(val, str):
        return val.strip().lower() in ("true", "1", "yes", "t")
    return bool(val)


@app.post(
    "/api/v1/liveness/init-session",
    summary="Khởi tạo phiên thử thách Liveness từ ảnh chuẩn Bước 1"
)
async def init_liveness_session_endpoint(
    request: Request,
    file: Optional[UploadFile] = File(None, description="Ảnh chuẩn Bước 1 (Base Frame)"),
    session_id: Optional[str] = Form(None, description="Mã phiên tùy chọn")
):
    """Khởi tạo phiên Liveness: kiểm tra 1 người duy nhất và trích xuất descriptor để chống tráo đổi người."""
    pipeline: EKYCPipelineServer = request.app.state.pipeline

    image_input = None
    if file is not None:
        image_input = await file.read()
    else:
        try:
            body = await request.json()
            image_input = body.get("image_base64")
            session_id = body.get("session_id", session_id)
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Vui lòng cung cấp file ảnh hoặc trường 'image_base64'."
            )

    if not image_input:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Dữ liệu ảnh rỗng."
        )

    res = pipeline.init_liveness_session(image_input, session_id=session_id)
    if not res.get("success", False):
        err_msg = res.get("message", "Không thể khởi tạo phiên Liveness")
        err_code = res.get("error", "INIT_FAILED")
        print(f"[INIT LIVENESS SESSION FAILED] Error: {err_code} | Detail: {err_msg}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=err_msg
        )

    return res


@app.post(
    "/api/v1/liveness/reset-session",
    summary="Hủy phiên thử thách Liveness và giải phóng định danh trong bộ nhớ"
)
async def reset_liveness_session_endpoint(
    request: Request,
    session_id: Optional[str] = Form(None, description="Mã phiên Liveness cần hủy")
):
    """Hủy phiên Liveness và xóa descriptor để bắt đầu phiên mới hoàn toàn độc lập."""
    pipeline: EKYCPipelineServer = request.app.state.pipeline
    sess_id = session_id
    if not sess_id:
        try:
            body = await request.json()
            sess_id = body.get("session_id")
        except Exception:
            pass

    if sess_id:
        pipeline.reset_liveness_session(sess_id)

    return {"success": True, "message": "Đã hủy phiên Liveness và xóa bỏ toàn bộ định danh cũ."}


@app.post(
    "/api/v1/liveness/blink-frame",
    summary="Đánh giá chỉ số EAR và trạng thái chớp mắt trên từng frame"
)
async def evaluate_blink_frame_endpoint(
    request: Request,
    file: Optional[UploadFile] = File(None, description="Frame ảnh"),
    blink_counter: Optional[int] = Form(0, description="Số lần chớp mắt hiện tại"),
    blink_state: Optional[str] = Form("false", description="Trạng thái mắt đang nhắm"),
    baseline_ear: Optional[float] = Form(0.0, description="Chỉ số EAR mốc khi mở mắt"),
    session_id: Optional[str] = Form(None, description="Mã phiên liveness đối chiếu sinh trắc học"),
    base_file: Optional[UploadFile] = File(None, description="Ảnh chuẩn Bước 1 (nếu không dùng session)")
):
    """Phục vụ Web Client gửi frame đo chỉ số EAR, kiểm tra 1 người và đối chiếu danh tính với Bước 1."""
    pipeline: EKYCPipelineServer = request.app.state.pipeline

    image_input = None
    base_image_input = None
    if file is not None:
        image_input = await file.read()
        if base_file is not None:
            base_image_input = await base_file.read()
    else:
        try:
            body = await request.json()
            image_input = body.get("image_base64")
            base_image_input = body.get("base_image_base64")
            blink_counter = body.get("blink_counter", blink_counter)
            blink_state = body.get("blink_state", blink_state)
            baseline_ear = body.get("baseline_ear", baseline_ear)
            session_id = body.get("session_id", session_id)
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Vui lòng cung cấp file ảnh hoặc trường 'image_base64'."
            )

    if not image_input:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Dữ liệu ảnh rỗng."
        )

    is_closed = _parse_bool_param(blink_state)
    b_ear = float(baseline_ear or 0.0)

    try:
        res = pipeline.evaluate_blink_frame(
            frame_input=image_input,
            current_blink_counter=int(blink_counter or 0),
            current_blink_state=is_closed,
            baseline_ear=b_ear,
            session_id=session_id,
            base_frame_input=base_image_input
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Lỗi kiểm tra chớp mắt: {str(e)}"
        )

    return {"success": True, **res}


@app.post(
    "/api/v1/liveness/start-head",
    summary="Khởi tạo thử thách quay đầu ngẫu nhiên mới (Head Movement Challenge)"
)
async def start_head_challenge_endpoint(request: Request):
    """Bắt đầu thử thách quay đầu ngẫu nhiên: TURN_LEFT hoặc TURN_RIGHT (Chỉ quay trái hoặc quay phải)."""
    pipeline: EKYCPipelineServer = request.app.state.pipeline
    try:
        res = pipeline.start_head_challenge()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Không thể khởi tạo thử thách: {str(e)}"
        )
    return {"success": True, **res}


@app.post(
    "/api/v1/liveness/update-head",
    summary="Cập nhật frame và kiểm tra góc quay đầu theo thử thách"
)
async def update_head_challenge_endpoint(
    request: Request,
    file: Optional[UploadFile] = File(None, description="Frame ảnh"),
    session_id: Optional[str] = Form(None, description="Mã phiên liveness đối chiếu sinh trắc học"),
    base_file: Optional[UploadFile] = File(None, description="Ảnh chuẩn Bước 1 (nếu không dùng session)")
):
    """Nhận frame từ Web Client để tính toán góc Euler 3D, tiến trình quay đầu và đối chiếu danh tính."""
    pipeline: EKYCPipelineServer = request.app.state.pipeline

    image_input = None
    base_image_input = None
    if file is not None:
        image_input = await file.read()
        if base_file is not None:
            base_image_input = await base_file.read()
    else:
        try:
            body = await request.json()
            image_input = body.get("image_base64")
            base_image_input = body.get("base_image_base64")
            session_id = body.get("session_id", session_id)
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Vui lòng cung cấp file ảnh hoặc trường 'image_base64'."
            )

    if not image_input:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Dữ liệu ảnh rỗng."
        )

    try:
        res = pipeline.update_head_challenge(
            frame_input=image_input,
            session_id=session_id,
            base_frame_input=base_image_input
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Lỗi cập nhật thử thách quay đầu: {str(e)}"
        )

    return {"success": True, **res}


# =============================================================================
# 5. ESP32-CAM DEDICATED PIPELINE & NODE.JS WEBHOOK INTEGRATION
# =============================================================================

_ACTIVE_NODEJS_WEBHOOK_URL = NODEJS_WEBHOOK_URL

def dispatch_webhook_to_nodejs(payload: dict):
    """Chuyển tiếp kết quả xác thực từ AI Server sang Node.js Backend qua HTTP Webhook."""
    global _ACTIVE_NODEJS_WEBHOOK_URL
    if not _ACTIVE_NODEJS_WEBHOOK_URL:
        return

    import json
    import urllib.request
    try:
        data = json.dumps(payload, default=str).encode("utf-8")
        req = urllib.request.Request(
            _ACTIVE_NODEJS_WEBHOOK_URL,
            data=data,
            headers={"Content-Type": "application/json", "User-Agent": "FastAPI-EKYC-AI-Server/2.0"}
        )
        with urllib.request.urlopen(req, timeout=NODEJS_WEBHOOK_TIMEOUT) as response:
            code = response.getcode()
            print(f"[✓] [Webhook Node.js] Đã chuyển kết quả thành công tới: {_ACTIVE_NODEJS_WEBHOOK_URL} (HTTP {code})")
    except Exception as exc:
        print(f"[✕] [Webhook Node.js Lỗi] Không thể gửi tới {_ACTIVE_NODEJS_WEBHOOK_URL}: {exc}")




# =============================================================================
# RUNNER ENTRY POINT
# =============================================================================
if __name__ == "__main__":
    import uvicorn
    print("\n[INFO] Đang khởi động E-KYC Laptop AI Server tại http://127.0.0.1:8000...")
    print("[INFO] Tài liệu API tương tác: http://127.0.0.1:8000/docs")
    print("[INFO] Giao diện Xác thực e-KYC Laptop Webcam: http://127.0.0.1:8000/\n")
    uvicorn.run(
        "server_module.app:app",
        host="0.0.0.0",
        port=8000,
        reload=False,
        workers=1
    )
