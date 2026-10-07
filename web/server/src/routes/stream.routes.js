const express = require("express");
const router = express.Router();
const esp32StreamService = require("../services/esp32Stream.service");

// Ingestion từ ESP32 qua HTTP POST Fallback
router.post("/api/stream/frame", (req, res) => {
    esp32StreamService.handleHttpFrameIngest(req, res);
});

// Broadcast MJPEG Stream cho trình duyệt web (Cùng Same-Origin tránh lỗi CORS/Canvas)
router.get("/stream", (req, res) => {
    esp32StreamService.handleMjpegStream(req, res);
});

// Lấy 1 frame JPEG mới nhất trong RAM
router.get("/api/stream/latest", (req, res) => {
    esp32StreamService.handleGetLatestFrame(req, res);
});

// Kiểm tra trạng thái thiết bị ESP32 (is_live, esp32_ip, viewers...)
router.get("/api/device/info", (req, res) => {
    esp32StreamService.handleDeviceInfo(req, res);
});

// Cập nhật thủ công IP ESP32 nếu cần
router.all("/api/device/set-ip", (req, res) => {
    esp32StreamService.handleSetDeviceIp(req, res);
});

// Bật/Tắt Camera ESP32 theo yêu cầu (Chống nóng camera)
router.all("/api/camera/power", (req, res) => {
    esp32StreamService.handleCameraPower(req, res);
});

// Điều khiển thông số camera ESP32 (phơi sáng, bù sáng...)
router.get("/api/camera/control", (req, res) => {
    esp32StreamService.handleCameraControl(req, res);
});

// Webhook nhận kết quả từ AI Server
router.post("/api/ekyc/result", (req, res) => {
    console.log("[EKYC WEBHOOK RESULT]", req.body);
    res.json({ status: "SUCCESS", message: "Đã nhận kết quả eKYC" });
});

// Proxy chuyển tiếp các API eKYC AI Server (/api/v1) sang FastAPI (:8000)
router.use("/api/v1", (req, res) => {
    esp32StreamService.proxyToAiServer(req, res);
});

module.exports = router;
