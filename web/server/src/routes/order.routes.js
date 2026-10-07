const express = require("express");
const router = express.Router();
const orderController = require("../controllers/order.controller");

// Lưu thông tin người gửi/nhận tạm thời trên server
router.post("/pending", orderController.savePendingOrder);

// Lấy thông tin người gửi/nhận tạm thời đang lưu trên server
router.get("/pending", orderController.getPendingOrder);

// Tạo đơn hàng mới và chỉ định ngăn tủ trống
router.post("/create", orderController.createOrder);

// Đóng tủ sau khi bỏ hàng
router.post("/close-locker", orderController.closeLocker);

module.exports = router;
