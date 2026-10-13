# 📦 Hệ Thống Tủ Đồ Thông Minh e-KYC (Smart Locker) — Đề Tài NCKH

Dự án Nghiên cứu Khoa học (NCKH): **"Nghiên cứu, Thiết kế và Chế tạo Hệ Thống Tủ Đồ Thông Minh Tích Hợp Xác Thực Sinh Trắc Học e-KYC Chống Giả Mạo Bằng Trí Tuệ Nhân Tạo (AI Biometrics Smart Locker)"**.

---

## 📑 Mục Lục
1. [Giới Thiệu Tổng Quan](#-giới-thiệu-tổng-quan)
2. [Kiến Trúc Hệ Thống](#-kiến-trúc-hệ-thống)
3. [Cấu Trúc Thư Mục](#-cấu-trúc-thư-mục)
4. [Quy Trình Hoạt Động (Workflows)](#-quy-trình-hoạt-động-workflows)
   - [Luồng 1: Gửi Hàng (Deposit Flow)](#1-luồng-gửi-hàng-deposit-flow)
   - [Luồng 2: Nhận Hàng (Pickup Flow)](#2-luồng-nhận-hàng-pickup-flow)
5. [Đặc Tả API RESTful (Node.js Server)](#-đặc-tả-api-restful-nodejs-server)
6. [Giao Thức Truyền Thông MQTT (ESP32)](#-giao-thức-truyền-thông-mqtt-esp32)
7. [Mô Hình Trí Tuệ Nhân Tạo e-KYC](#-mô-hình-trí-tuệ-nhân-tạo-e-kyc)
8. [Yêu Cầu Hệ Thống (Requirements)](#-yêu-cầu-hệ-thống-system-requirements)
9. [Hướng Dẫn Cài Đặt & Khởi Chạy](#-hướng-dẫn-cài-đặt--khởi-chạy-từng-khối)
10. [Kiểm Thử Hệ Thống (Testing & Simulation)](#6-kiểm-thử-hệ-thống-testing--simulation)

---

## 🌟 Giới Thiệu Tổng Quan

Hệ thống kết hợp giữa **Cơ điện tử (Mechatronics)**, **Internet of Things (IoT)**, **Trí tuệ Nhân tạo (Computer Vision & Deep Learning)** và **Web Kiosk Thời gian thực**:
* **Cơ cấu tủ xoay (Carousel Locker):** Tang trống gồm **6 khay chứa đồ** vận hành bởi 1 động cơ giảm tốc JGY370 và hệ thống công tắc hành trình đếm bước, tiết kiệm không gian lắp đặt so với tủ ma trận truyền thống.
* **Bảo mật sinh trắc học e-KYC:** Xác thực danh tính người gửi bằng nhận diện khuôn mặt và thử thách người thật thời gian thực (Active Liveness Detection) kết hợp chống giả mạo đa mô hình (Ensemble Anti-Spoofing: YOLOv11 + RF-DETR).
* **Quản lý đơn hàng & mã OTP:** Tự động chỉ định khay tủ trống, sinh mã OTP bí mật cho người nhận, tra cứu và giải phóng khay tủ tự động sau khi giao dịch hoàn tất.

---

## 🏛️ Kiến Trúc Hệ Thống

```
                                +-----------------------------+
                                |      Web Client Kiosk       |
                                |  (Tailwind CSS, HTML5, JS)  |
                                +--------------+--------------+
                                               |
                                     HTTP REST / WebSocket
                                               |
                                               v
+-----------------------------+        +----------------------+        +-----------------------------+
|    AI e-KYC Server (8000)   |<-------| Node.js Server (3000)|------->|      Cơ sở Dữ liệu MySQL    |
| (FastAPI, YOLOv11, RF-DETR, | HTTP   | (Express.js, MQTT,   | SQL    |       (smart_locker_db)     |
|  MediaPipe 478 Landmarks)   |------->|  ffmpeg-static)      |        |        Bảng TU & DON_HANG   |
+-----------------------------+        +----------+-----------+        +-----------------------------+
                                                  |
                                             MQTT Protocol
                                         (broker.emqx.io:1883)
                                                  |
                         +------------------------+------------------------+
                         |                                                 |
                         v                                                 v
           +---------------------------+                     +---------------------------+
           |       ESP32 Control       |                     |      ESP32-S3 Camera      |
           |  - Động cơ xoay JGY370    |                     |  - OV2640 Sensor          |
           |  - Servo chốt cửa         |                     |  - Live MJPEG Stream / WS |
           |  - 4 Limit Switches       |                     |  - Anti-Overheating       |
           +---------------------------+                     +---------------------------+
```

---

## 📁 Cấu Trúc Thư Mục

```text
Code_NCKH/
├── AI/
│   └── EKYC/                          # Máy chủ Trí tuệ Nhân tạo e-KYC (FastAPI Python)
│       ├── start_ai_server.bat        # Script khởi động nhanh server AI (:8000)
│       ├── requirements.txt           # Thư viện Python (ultralytics, mediapipe, torch...)
│       ├── README.md                  # Hướng dẫn chi tiết module AI
│       └── server_module/
│           ├── app.py                 # FastAPI Application chính
│           ├── pipeline_server.py     # Lõi xử lý AI Pipeline
│           ├── ensemble_anti_spoof.py # Mô hình kết hợp YOLOv11 + RF-DETR
│           ├── models/                # Trọng số mô hình (.pt, .onnx, .task)
│           └── static/                # Giao diện kiểm thử AI
│
├── esp32/
│   ├── Control/                       # Firmware điều khiển cơ cấu tủ (PlatformIO C++)
│   │   ├── platformio.ini             # Cấu hình PlatformIO cho ESP32
│   │   └── src/
│   │       ├── main.cpp               # Logic quay khay, mở chốt servo, giao tiếp MQTT
│   │       ├── Config.h               # Định nghĩa chân GPIO, thông số WiFi và MQTT
│   │       ├── actuators/             # Driver động cơ JGY370 và ServoMotor
│   │       └── sensors/               # Driver cảm biến công tắc hành trình (LimitSwitch)
│   │
│   └── EKYC/                          # Firmware camera ESP32-S3-CAM (PlatformIO C++)
│       ├── platformio.ini             # Cấu hình Flash 16MB + OPI PSRAM 8MB
│       └── src/
│           └── main.cpp               # Truyền luồng MJPEG/WebSocket, kiểm soát nhiệt
│
└── web/
    ├── server/                        # Backend điều phối trung tâm (Node.js Express)
    │   ├── server.js                  # Điểm khởi động server (:3000)
    │   ├── package.json               # Dependencies (express, mysql2, mqtt, ffmpeg...)
    │   ├── .env                       # File cấu hình môi trường
    │   ├── database/
    │   │   └── schema.sql             # Script khởi tạo CSDL MySQL (Bảng TU, DON_HANG)
    │   └── src/
    │       ├── config/                # Cấu hình Database, biến môi trường, constants
    │       ├── controllers/           # Order, Locker, eKYC controllers
    │       ├── services/              # OrderService, MqttService, eKYCService, VideoRecorder
    │       ├── routes/                # Định nghĩa các API endpoints
    │       └── middleware/            # Kiểm tra dữ liệu đầu vào, xử lý lỗi
    │
    └── client/                        # Giao diện người dùng Kiosk (Frontend Web)
        ├── index.html                 # Màn hình chính (Chọn Gửi hàng / Nhận hàng)
        ├── send.html                  # Nhập thông tin người gửi & người nhận
        ├── kyc.html                   # Quét sinh trắc học e-KYC (Camera Oval HUD)
        ├── receive.html               # Màn hình nhập SĐT & mã OTP nhận hàng
        ├── locker.html                # Màn hình theo dõi mở/đóng tủ (Gửi hàng & Nhận hàng)
        └── assets/                    # CSS, JavaScript dùng chung, âm thanh, icons
```

---

## 🔄 Quy Trình Hoạt Động (Workflows)

### 1. Luồng Gửi Hàng (Deposit Flow)
```
[index.html] -> Bấm "Gửi hàng"
      |
      v
[send.html]  -> Nhập Tên & SĐT người gửi, Tên & SĐT người nhận
      |      -> Gọi POST /api/orders/save-info lưu tạm thông tin
      v
[kyc.html]   -> Bật Camera quét khuôn mặt qua 4 thử thách AI:
      |         1. Căn chỉnh khuôn mặt vào khung Oval (Oval Alignment & 3D Pose)
      |         2. Thử thách chớp mắt tự nhiên (Adaptive EAR Blink)
      |         3. Thử thách quay đầu ngẫu nhiên (3D Head Turn: Left/Right)
      |         4. Thẩm định chống giả mạo (YOLOv11 + RF-DETR Anti-Spoofing)
      v
[locker.html]-> Hệ thống gọi POST /api/orders/create:
      |         - Server tìm khay tủ trống đầu tiên (TRONG = 1)
      |         - Gửi lệnh MQTT "OPEN" tới ESP32 Control
      |         - ESP32 quay motor JGY370 tới khay chỉ định, mở servo chốt cửa
      v
[Cất đồ]     -> Người gửi bỏ kiện hàng vào khay tủ và bấm "ĐÓNG TỦ"
      |      -> Gọi POST /api/orders/close-locker:
      |         - Gửi lệnh MQTT "CLOSE" đóng servo chốt cửa
      |         - Đánh dấu khay tủ đã có hàng (TRONG = 0)
      |         - Cập nhật trạng thái đơn (TRANG_THAI = 1 - STORED)
      v
[Hoàn tất]   -> Màn hình hiển thị thông báo thành công kèm:
                + Mã đơn hàng (VD: DH782103)
                + Mã OTP 6 chữ số (VD: 782103) để gửi cho người nhận
```

---

### 2. Luồng Nhận Hàng (Pickup Flow)
```
[index.html]   -> Bấm "Nhận hàng"
      |
      v
[receive.html] -> Người nhận nhập SĐT người nhận và Mã OTP (hoặc mã đơn hàng)
      |        -> Bấm "Xác nhận", kiểm tra tính hợp lệ
      |        -> Gọi POST /api/orders/receive gửi { receivePhone, receiveOtp }
      v
[Xác thực DB]  -> Server tra cứu đơn hàng trong bảng DON_HANG:
      |           + Khớp SDT_NGUOI_NHAN
      |           + Khớp OTP hoặc MA_DON_HANG
      |           + Trạng thái TRANG_THAI = 1 (Đang lưu trong tủ)
      |        -> Tìm thấy đơn: xác định vị trí khay tủ đang chứa hàng (TU)
      |        -> Bắn lệnh MQTT "OPEN" tới ESP32 Control với lockerId tương ứng
      v
[locker.html?mode=receive] -> Giao diện chuyển sang chế độ "Mở Tủ Lấy Hàng"
      |                   -> ESP32 quay tang trống đến đúng khay và mở chốt servo
      |                   -> Người nhận lấy kiện hàng ra khỏi tủ
      v
[Đóng tủ]      -> Người nhận bấm nút "ĐÓNG TỦ & HOÀN TẤT"
      |        -> Gọi POST /api/orders/close-locker:
      |           - Server nhận diện phiên RECEIVE
      |           - Gửi lệnh MQTT "CLOSE" đóng chốt tủ
      |           - Giải phóng khay tủ thành TRỐNG (UPDATE TU SET TRONG = 1)
      |           - Cập nhật trạng thái đơn hàng sang HOÀN TẤT (TRANG_THAI = 2)
      v
[Hoàn tất]     -> Thông báo nhận hàng thành công và quay về trang chủ
```

---

## 📡 Đặc Tả API RESTful (Node.js Server)

| Phương thức | Đường dẫn API | Mô tả chức năng | Request Body mẫu |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/lockers/check` | Kiểm tra xem còn khay tủ trống không | Không |
| `GET` | `/api/lockers/status` | Lấy trạng thái kết nối MQTT & thiết bị ESP32 | Không |
| `POST` | `/api/orders/save-info` | Lưu tạm thông tin người gửi/nhận trước khi KYC | `{"senderName":"An","senderPhone":"0912345678","receiverName":"Binh","receiverPhone":"0987654321"}` |
| `GET` | `/api/orders/pending` | Đọc thông tin người gửi/nhận đang lưu tạm | Không |
| `POST` | `/api/orders/create` | Tạo đơn mới, cấp khay trống và phát lệnh MQTT mở tủ | `{"senderName":"...","senderPhone":"...","receiverName":"...","receiverPhone":"..."}` |
| `POST` | `/api/orders/receive` | Xác thực SĐT + OTP nhận hàng và phát lệnh MQTT mở tủ | `{"receivePhone":"0987654321","receiveOtp":"782103"}` |
| `POST` | `/api/orders/close-locker` | Đóng tủ (tự động phân biệt gửi hàng hoặc nhận hàng để cập nhật CSDL) | Không |
| `GET` | `/api/orders/active` | Lấy thông tin phiên mở tủ đang hoạt động | Không |
| `POST` | `/api/ekyc/verify` | Chuyển tiếp ảnh webcam/stream tới AI server để thẩm định | `{"image":"data:image/jpeg;base64,..."}` |
| `POST` | `/api/ekyc/result` | Webhook tiếp nhận kết quả thẩm định từ AI Server | `{"verdict":"APPROVED","session_id":"..."}` |
| `POST` | `/api/ekyc/session-video`| Lưu trữ video quay lại toàn bộ phiên KYC làm bằng chứng | Binary Video Stream |
| `GET` | `/api/ekyc/session-videos`| Liệt kê danh sách video KYC đã lưu trong hệ thống | Không |

---

## 🔌 Giao Thức Truyền Thông MQTT (ESP32)

Hệ thống sử dụng MQTT Broker chuẩn (mặc định `broker.emqx.io:1883`, QoS 1):

* **Topic Lệnh Điều Khiển (`SMART_LOCKER/LOCKER/CMD`):**
  * Node.js Server $\rightarrow$ ESP32:
  ```json
  {
    "action": "OPEN",
    "lockerId": 3,
    "timestamp": 1728800000000
  }
  ```
  ```json
  {
    "action": "CLOSE",
    "lockerId": 3,
    "timestamp": 1728800000000
  }
  ```

* **Topic Phản Hồi Trạng Thái (`SMART_LOCKER/LOCKER/STATE`):**
  * ESP32 $\rightarrow$ Node.js Server:
  ```json
  {
    "action": "OPEN",
    "lockerId": 3,
    "status": "OPENED",
    "door": "OPEN"
  }
  ```

* **Topic Trạng Thái ESP32 (`SMART_LOCKER/ESP32/STATUS`):**
  * Bản tin nhịp tim (Heartbeat):
  ```json
  {
    "status": "ONLINE",
    "currentTray": 3,
    "door": "CLOSED",
    "freeHeap": 182400
  }
  ```

---

## 🧠 Mô Hình Trí Tuệ Nhân Tạo e-KYC

Hệ thống AI chạy độc lập trên **FastAPI Python** tại cổng `8000`:
1. **YOLO Face Detection:** Nhận diện vị trí khuôn mặt với độ tin cậy cao.
2. **MediaPipe 478 3D Facial Landmarks:**
   * Tính toán góc quay đầu 3D Euler: Yaw (quay ngang), Pitch (ngước/cúi), Roll (nghiêng).
   * Kiểm tra căn chỉnh Oval: Landmarks khuôn mặt phải nằm trọn trong khung Oval chuẩn ($\ge 90\%$).
3. **Adaptive Eye Aspect Ratio (EAR):** Đo cử động chớp mắt tự nhiên.
4. **Ensemble Anti-Spoofing:**
   * **YOLOv11 Face Anti-Spoofing** + **RF-DETR Small Transformer**.
   * Cơ chế **Soft Voting** kết hợp **Spoof Veto**: Nếu 1 trong 2 mô hình phát hiện dấu hiệu giả mạo $\ge 0.65$, hệ thống lập tức phủ quyết để ngăn chặn ảnh in giấy, màn hình điện thoại hoặc mặt nạ silicon.

---

## 📋 Yêu Cầu Hệ Thống (System Requirements)

Để triển khai và vận hành đầy đủ toàn bộ hệ thống Smart Locker, cần chuẩn bị các yêu cầu phần cứng và phần mềm sau:

### 1. Yêu Cầu Phần Cứng (Hardware Requirements)
* **Khối Điều khiển Cơ cấu Tủ (ESP32 Control):**
  * **01 x Board ESP32 NodeMCU-32S / ESP32-WROOM-32** (Dual-core 240MHz, tích hợp WiFi & Bluetooth).
  * **01 x Động cơ giảm tốc trục vít JGY-370 (12V DC, 10 - 20 RPM)**: Mô-men xoắn lớn, tự hãm khi ngắt điện, dùng xoay cụm tang trống 6 khay.
  * **01 x Động cơ Servo SG90 hoặc MG996R (5V DC)**: Dùng khóa/mở chốt cửa khay tủ.
  * **01 x Mạch công suất Driver (Relay 12V 1 kênh hoặc Mạch MOSFET/L298N)**: Đóng ngắt nguồn điều khiển động cơ JGY-370.
  * **04 x Công tắc hành trình (Limit Switch có cần gạt):**
    * `LW_KHAY_GOC` (GPIO 41): Xác định vị trí gốc (Home / Khay 1).
    * `LW_DEM_KHAY` (GPIO 42): Đếm bước chuyển tiếp giữa các khay (Khay 1 $\rightarrow$ 6).
    * `LW_SERVO` (GPIO 47): Giám sát trạng thái chốt khóa.
    * `LW_CUA` (GPIO 21): Giám sát trạng thái cánh cửa tủ (Mở / Đóng).
  * **Nguồn điện:**
    * 01 x Nguồn Adapter / Tổ ong 12V DC - 2A (cấp nguồn động cơ JGY-370).
    * 01 x Nguồn Adapter 5V DC - 2A (cấp nguồn ESP32 và Servo).

* **Khối Camera Sinh Trắc Học (ESP32-S3-CAM):**
  * **01 x Board ESP32-S3-CAM N16R8** (16MB Flash, 8MB OPI PSRAM, camera OV2640 / OV3660 / OV5640) hoặc Webcam USB / Laptop Webcam tích hợp.
  * Cáp nạp USB Type-C hỗ trợ truyền dữ liệu.

* **Thiết bị Máy chủ & Màn hình Kiosk:**
  * **Máy tính Kiosk / Laptop:**
    * **CPU:** Tối thiểu Intel Core i3 Thế hệ 8 hoặc AMD Ryzen 3 (Khuyến nghị Core i5 / Ryzen 5 trở lên).
    * **RAM:** Tối thiểu 8 GB RAM (Khuyến nghị 16 GB để chạy đồng thời Node.js, MySQL và mô hình AI PyTorch).
    * **Ổ cứng:** Còn trống tối thiểu 5 GB (cho dependencies, CSDL và lưu trữ video phiên eKYC).
    * **Camera:** Webcam độ phân giải tối thiểu 720p (HD).

---

### 2. Yêu Cầu Phần Mềm & Môi Trường (Software Requirements)
* **Hệ điều hành:** Windows 10/11 (64-bit), Ubuntu Linux 20.04+, hoặc macOS.
* **Node.js Runtime:** Phiên bản **v18.x, v20.x hoặc v22.x LTS** (kèm theo trình quản lý gói `npm`).
* **Python Runtime:** Phiên bản **3.10.x hoặc 3.11.x** (khuyến nghị 3.10 để tương thích tối đa với MediaPipe và PyTorch).
* **Cơ sở dữ liệu:** **MySQL Server 5.7+ hoặc 8.0+** (Khuyến nghị cài đặt trọn gói bằng **Laragon Full** hoặc **XAMPP** trên Windows).
* **IDE & Công cụ Nạp Code:**
  * **Visual Studio Code** (VS Code).
  * Tiện ích mở rộng **PlatformIO IDE** (để biên dịch và nạp code C++ vào ESP32).
* **Trình duyệt Web:** Google Chrome, Microsoft Edge, Firefox bản mới nhất (hỗ trợ chuẩn HTML5 `getUserMedia`, WebSocket RFC 6455).

---

### 3. Danh Mục Thư Viện Phụ Thuộc (Dependencies Checklist)

* **Node.js Backend (`web/server/package.json`):**
  * `express` (`^5.2.1`): Web server định tuyến RESTful API.
  * `mysql2` (`^3.24.5`): Thư viện kết nối MySQL với Connection Pool & Async/Await.
  * `mqtt` (`^5.16.0`): MQTT Client giao tiếp hai chiều thời gian thực với ESP32.
  * `dotenv` (`^18.0.5`): Đọc cấu hình biến môi trường từ file `.env`.
  * `ffmpeg-static` (`^5.3.0`): Biên dịch và xuất video ghi hình phiên eKYC.

* **Python AI Server (`AI/EKYC/requirements.txt`):**
  * `fastapi`, `uvicorn`: Framework máy chủ API bất đồng bộ hiệu năng cao.
  * `ultralytics`: Framework chạy mô hình YOLO Face Detection và YOLOv11 Anti-Spoofing.
  * `mediapipe`: Nhận diện 478 điểm mốc khuôn mặt 3D và tính toán góc quay đầu Euler.
  * `torch`, `torchvision`: Lõi tính toán Deep Learning PyTorch.
  * `opencv-python`, `numpy`, `pillow`: Thuật toán xử lý ma trận hình ảnh, tính toán tỷ lệ EAR và khung Oval.

* **ESP32 Firmware (`esp32/Control/platformio.ini`):**
  * `knolleary/PubSubClient` (`@^2.8`): Thư viện MQTT Client cho ESP32.
  * `ESP32Servo`: Điều khiển xung PWM cho động cơ servo mở khóa.

---

## 🚀 Hướng Dẫn Cài Đặt & Khởi Chạy Từng Khối

### 2. Cấu hình & Khởi chạy Node.js Server
1. Mở Terminal tại thư mục `Code_NCKH/web/server`:
   ```bash
   npm install
   ```
2. Khởi động MySQL trong Laragon (Port 3306, user `root`, mật khẩu để trống).
   * File `.env` đã được cấu hình sẵn kết nối mặc định.
   * Server sẽ **tự động tạo database `smart_locker_db`** và các bảng dữ liệu khi khởi động lần đầu.
3. Khởi động server:
   ```bash
   npm start
   ```
   Server sẽ lắng nghe tại: **`http://localhost:3000`**.

---

### 3. Khởi chạy AI FastAPI Server
1. Mở thư mục `Code_NCKH/AI/EKYC`.
2. Khởi động nhanh bằng cách nhấp đúp file:
   ```cmd
   start_ai_server.bat
   ```
   Hoặc chạy dòng lệnh:
   ```bash
   pip install -r requirements.txt
   uvicorn server_module.app:app --host 0.0.0.0 --port 8000
   ```
   AI Server sẽ lắng nghe tại: **`http://localhost:8000`**.

---

### 4. Nạp Firmware cho ESP32
1. **ESP32 Điều khiển Cơ cấu Tủ (`Code_NCKH/esp32/Control`):**
   * Mở thư mục bằng VS Code có cài PlatformIO.
   * Cập nhật thông tin WiFi (`WIFI_SSID`, `WIFI_PASSWORD`) trong file `src/Config.h`.
   * Cắm ESP32 và nhấn **Upload** (`➔`).
2. **ESP32-S3 Camera (`Code_NCKH/esp32/EKYC`):**
   * Cập nhật SSID và Password WiFi trong file `include/config_secret.h`.
   * Cắm ESP32-S3-CAM và nhấn **Upload** (`➔`).

---

### 5. Truy Cập Giao Diện Kiosk
Mở trình duyệt Web (Chrome / Edge) và truy cập:
👉 **[http://localhost:3000/](http://localhost:3000/)**
* Chọn **Gửi hàng** để trải nghiệm luồng tạo đơn, quét eKYC, nhận diện khuôn mặt và cấp tủ.
* Chọn **Nhận hàng** để nhập SĐT và mã OTP vừa nhận để mở tủ lấy hàng và giải phóng tủ tự động.

---

### 6. Kiểm Thử Hệ Thống (Testing & Simulation)

Hệ thống được trang bị sẵn 2 công cụ kiểm thử mạnh mẽ:

1. **Bộ Giả Lập Phần Cứng ESP32 (Virtual Hardware Simulator):**
   * Nếu chưa kết nối board ESP32 thật, mở một cửa sổ Terminal tại `web/server` và chạy:
     ```bash
     npm run sim
     ```
   * Script này sẽ giả lập ESP32 kết nối MQTT, phát nhịp tim online và tự động xoay khay/đóng mở servo khi nhận lệnh từ máy chủ.

2. **Chạy Kịch Bản Kiểm Thử Tự Động (Automated Integration Test):**
   * Đảm bảo Node.js server đang chạy (`npm start`), mở một Terminal khác tại `web/server` và gõ:
     ```bash
     npm test
     ```
   * Script `test_system.js` sẽ tự động thực thi chuỗi 11 bài kiểm thử End-to-End:
     1. Kiểm tra Health Check & MySQL Laragon.
     2. Kiểm tra Python AI Server.
     3. Kiểm tra danh sách khay tủ & kết nối MQTT.
     4. Kiểm thử endpoint eKYC.
     5. Lưu thông tin người gửi/nhận.
     6. Tạo đơn & cấp ngăn tủ trống.
     7. Đóng tủ gửi hàng.
     8. Kiểm thử nhập sai OTP (bảo mật).
     9. Nhập đúng SĐT + OTP nhận hàng để mở tủ.
     10. Đóng tủ nhận hàng.
     11. Xác nhận khay tủ đã được giải phóng thành TRỐNG (`TRONG = 1`) trong CSDL.
