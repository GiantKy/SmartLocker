# Hệ Thống e-KYC AI Sinh Trắc Học (Phiên Bản Laptop Webcam & Simple UI) — EKYC_release_2

Phiên bản phát hành **EKYC_release_2** được tinh gọn chuyên biệt cho máy tính cá nhân / laptop:
- **Chỉ sử dụng Camera / Webcam tích hợp của Laptop** (chuẩn HTML5 `getUserMedia`).
- **Hoàn toàn loại bỏ ESP32-CAM và Node.js Stream Receiver**: Chạy trực tiếp 100% bằng máy chủ AI FastAPI Python độc lập.
- **Sử dụng duy nhất giao diện Tối giản (Simple UI)**: Thiết kế chuẩn kiosk điện thoại, tập trung vào khung Oval và hướng dẫn người dùng trực quan, rõ ràng.

---

## 🚀 Hướng Dẫn Khởi Chạy Nhanh

### Cách 1: Khởi chạy bằng file BAT (Khuyến nghị)
Nhấp đúp chuột vào file:
```bat
start_ai_server.bat
```
*(File này sẽ tự động phát hiện môi trường Python có sẵn `ultralytics`, giải phóng cổng 8000 nếu bị chiếm và khởi động server).*

### Cách 2: Khởi chạy thủ công bằng dòng lệnh
Mở Terminal / PowerShell tại thư mục `EKYC_release_2`:
```bash
python server_module/app.py
```
Hoặc:
```bash
uvicorn server_module.app:app --host 0.0.0.0 --port 8000
```

### Truy cập Giao Diện:
Mở trình duyệt Web (Chrome, Edge, Firefox) và truy cập:
👉 **[http://localhost:8000/](http://localhost:8000/)**
*(Hệ thống sẽ trực tiếp hiển thị giao diện Xác thực e-KYC Tối giản và tự động mở camera laptop).*

---

## 🛡️ Quy Trình 4 Bước Xác Thực e-KYC

1. **Bước 1: Căn chỉnh khuôn mặt vào khung Oval (Oval Alignment & Pose)**
   - Toàn bộ khuôn mặt phải nằm trọn bên trong khung oval (đáp ứng tiêu chuẩn $\ge 90\%$ landmarks và không tràn má/trán/cằm ra ngoài).
   - Giữ mặt thẳng ngang tầm mắt và giữ ổn định trong 3 frame liên tiếp (~0.6s).
   - Hệ thống đếm ngược `3` $\rightarrow$ `2` $\rightarrow$ `1` $\rightarrow$ `0`.
   - **Tính năng An toàn Thời gian thực**: Nếu trong thời gian đếm số 3 2 1 mà khuôn mặt rời khỏi khung oval hoặc quay đầu, hệ thống sẽ **hủy đếm ngược ngay lập tức** và yêu cầu căn chỉnh lại.

2. **Bước 2: Thử thách Chớp mắt Tự nhiên (Eye Blink EAR)**
   - Hệ thống tự động nhận diện cử động chớp mắt bằng thuật toán tính toán thích ứng (Adaptive Eye Aspect Ratio - EAR).
   - Kiểm tra liên tục tính nhất quán sinh trắc học để đảm bảo cùng 1 người.

3. **Bước 3: Thử thách Quay đầu Ngẫu nhiên (3D Head Turn Challenge)**
   - Hệ thống phát sinh ngẫu nhiên yêu cầu quay đầu sang trái (`TURN_LEFT`) hoặc sang phải (`TURN_RIGHT`).
   - Đánh giá chuyển động góc Euler 3D (Yaw/Pitch/Roll) theo thời gian thực.

4. **Bước 4: Thẩm định Chống Giả Mạo Ensemble (YOLOv11 + RF-DETR)**
   - Đồng thuận 2 mô hình Deep Learning tiên tiến nhất:
     - YOLOv11 Face Anti-Spoofing
     - RF-DETR Small Object & Spoof Detector
   - Ngăn chặn triệt để mọi hành vi gian lận: in ảnh giấy, màn hình điện thoại/tablet, mặt nạ silicon.

---

## 📁 Cấu Trúc Thư Mục `EKYC_release_2`

```
EKYC_release_2/
├── start_ai_server.bat        # File khởi động nhanh máy chủ AI (:8000)
├── requirements.txt           # Danh mục thư viện Python cần thiết
├── README.md                  # Hướng dẫn chi tiết
└── server_module/
    ├── app.py                 # FastAPI Application chính (chỉ phục vụ Laptop Webcam & Simple UI)
    ├── pipeline_server.py     # Lõi xử lý AI Pipeline e-KYC (Face Detection, Pose, Liveness, Ensemble)
    ├── ensemble_anti_spoof.py # Mô hình Ensemble YOLOv11 + RF-DETR
    ├── anti_spoof_yolo.py     # Detector YOLO chống giả mạo
    ├── config.py              # Cấu hình ngưỡng chuẩn (Oval, Yaw, Pitch, EAR, v.v.)
    ├── utils.py               # Thư viện thuật toán hình học Oval, đo EAR, xử lý ảnh
    ├── schemas.py             # Pydantic Schemas request/response
    ├── models/                # Trọng số mô hình AI (YOLO, RF-DETR, MediaPipe)
    ├── components/            # Các module chuyên biệt (Face Detection, Landmarks, Pose, Occlusion)
    └── static/
        ├── index.html         # Giao diện Tối giản e-KYC mặc định (Laptop Webcam)
        └── simple.html        # Bản sao giao diện Tối giản (cho endpoint /simple và /kiosk)
```
