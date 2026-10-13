const express = require("express");
const router = express.Router();
const ekycController = require("../controllers/ekyc.controller");

// Xác thực khuôn mặt
router.post("/verify", ekycController.verifyFace);

// Lưu trữ video quay lại toàn bộ phiên eKYC từ đầu tới cuối
router.post("/session-video", ekycController.saveSessionVideo);

// Danh sách video phiên eKYC đã lưu trữ
router.get("/session-videos", ekycController.listSessionVideos);

// Webhook nhận kết quả từ Python AI Server
router.post("/result", ekycController.handleAiWebhook);

module.exports = router;
