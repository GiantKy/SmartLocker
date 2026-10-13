const express = require("express");
const router = express.Router();
const orderController = require("../controllers/order.controller");
const { validateOrderInfo, validateReceiveInfo } = require("../middleware/order.middleware");

// Lưu thông tin người gửi/nhận tạm thời trên server (qua middleware kiểm tra đầy đủ & hợp lệ)
router.post("/save-info", validateOrderInfo, orderController.savePendingOrder);

// Lấy thông tin người gửi/nhận tạm thời trên server
router.get("/pending", orderController.getPendingOrder);

// Tạo đơn hàng mới và chỉ định ngăn tủ trống (Luồng Gửi hàng)
router.post("/create", orderController.createOrder);

// Xác thực SĐT & OTP để mở tủ lấy hàng (Luồng Nhận hàng)
router.post("/receive", validateReceiveInfo, orderController.receiveOrder);

// Đóng tủ sau khi bỏ hàng hoặc lấy hàng
router.post("/close-locker", orderController.closeLocker);

// Lấy thông tin khay tủ đang mở
router.get("/active", orderController.getActiveOrder);

module.exports = router;
