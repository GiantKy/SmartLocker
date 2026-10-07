import math
import numpy as np


class HeadPoseEstimator:
    """
    Bộ ước lượng tư thế 3D khuôn mặt (Euler Angles: Yaw, Pitch, Roll).
    
    Phương pháp: Mô hình giải tích hình học trực giao (Orthogonal Facial Projection Geometry)
    - Miễn nhiễm hoàn toàn với các lỗi Gimbal Lock, lật nghiệm cục bộ (Local Minima) của solvePnP.
    - Không phụ thuộc vào giả định tiêu cự (Focal Length) hay mô hình 3D mẫu cứng nhắc.
    - Chuẩn hóa tỷ lệ bất biến theo kích thước mặt của từng người dùng thực tế.
    """

    def __init__(self, w: int = 640, h: int = 480):
        self.w = w
        self.h = h

    def estimate(self, landmarks, get_point, img_w=None, img_h=None):
        """
        Tính toán 3 góc Euler (Yaw, Pitch, Roll) từ các điểm mốc MediaPipe FaceMesh.
        
        Args:
            landmarks: Danh sách tọa độ các điểm mốc (x, y)
            get_point: Hàm trích xuất tọa độ điểm mốc theo chỉ số index
            img_w: Chiều rộng khung hình ảnh (tùy chọn)
            img_h: Chiều cao khung hình ảnh (tùy chọn)
            
        Returns:
            Dict chứa {"yaw": float, "pitch": float, "roll": float} hoặc None nếu thiếu mốc.
        """
        try:
            nose = get_point(landmarks, 1)        # Đỉnh mũi
            chin = get_point(landmarks, 152)      # Đáy cằm
            le = get_point(landmarks, 33)         # Đuôi mắt trái trên ảnh (mắt phải người dùng)
            re = get_point(landmarks, 263)        # Đuôi mắt phải trên ảnh (mắt trái người dùng)
            bridge = get_point(landmarks, 168)    # Gốc sống mũi (giữa 2 mắt)
            forehead = get_point(landmarks, 10)   # Đỉnh trán

            if not all([nose, chin, le, re]):
                return None

            nose = np.array(nose[:2], dtype=np.float64)
            chin = np.array(chin[:2], dtype=np.float64)
            le = np.array(le[:2], dtype=np.float64)
            re = np.array(re[:2], dtype=np.float64)

            # =====================================================================
            # 1. ROLL (Góc nghiêng đầu sang vai)
            # =====================================================================
            dx_eyes = re[0] - le[0]
            dy_eyes = re[1] - le[1]
            eye_dist = math.hypot(dx_eyes, dy_eyes)
            if eye_dist < 1e-4:
                return None
            roll = math.degrees(math.atan2(dy_eyes, dx_eyes))

            # Hệ trục tọa độ mặt phẳng khuôn mặt (khử hoàn toàn ảnh hưởng của Roll)
            u_eyes = (re - le) / eye_dist
            eye_center = (le + re) / 2.0

            # =====================================================================
            # 2. YAW (Góc quay mặt trái / phải)
            # =====================================================================
            # Hình chiếu của đỉnh mũi lên đường nối 2 mắt
            nose_proj = np.dot(nose - eye_center, u_eyes)
            # Chuẩn hóa theo bán kính mắt (khoảng cách từ tâm mắt tới đuôi mắt ~ 0.48 - 0.50):
            ratio_yaw = nose_proj / (eye_dist * 0.48)
            ratio_yaw = max(-0.95, min(0.95, ratio_yaw))
            
            # Quy ước toàn hệ thống (Webcam gương / người dùng):
            # - Quay Trái: Yaw ÂM (< 0)
            # - Quay Phải: Yaw DƯƠNG (> 0)
            yaw = math.degrees(math.asin(ratio_yaw))

            # =====================================================================
            # 3. PITCH (Góc gật đầu quanh trục X: ngước lên / cúi xuống)
            # =====================================================================
            top_pt = np.array(forehead[:2], dtype=np.float64) if forehead is not None else (
                np.array(bridge[:2], dtype=np.float64) if bridge is not None else eye_center
            )
            face_h = np.linalg.norm(chin - top_pt)
            if face_h < 1e-4:
                face_h = eye_dist * 1.5

            # Trục dọc vuông góc với trục mắt (hướng từ trên xuống cằm)
            u_vert = np.array([-u_eyes[1], u_eyes[0]])
            nose_vert = np.dot(nose - eye_center, u_vert)

            # Tỷ lệ khoảng cách mắt-mũi so với chiều cao mặt chuẩn nhân trắc học (~ 0.20 - 0.22)
            baseline_vert_ratio = 0.21
            norm_vert = (nose_vert / face_h) - baseline_vert_ratio
            ratio_pitch = max(-0.95, min(0.95, norm_vert * 3.2))
            pitch = math.degrees(math.asin(ratio_pitch))

            return {
                "yaw": round(yaw, 2),
                "pitch": round(pitch, 2),
                "roll": round(roll, 2)
            }
        except Exception:
            return None