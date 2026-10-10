const express = require("express");
const router = express.Router();
const lockerController = require("../controllers/locker.controller");

// Kiểm tra khay tủ trống
router.get("/check", lockerController.checkAvailable);

// Mở khay tủ qua MQTT
router.post("/open", lockerController.openLocker);

// Đóng khay tủ qua MQTT
router.post("/close", lockerController.closeLocker);

// Trạng thái kết nối MQTT & ESP32
router.get("/status", lockerController.getStatus);

module.exports = router;
