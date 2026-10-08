const express = require("express");
const router = express.Router();
const orderController = require("../controllers/order.controller");
const { validateOrderInfo } = require("../middleware/order.middleware");

// Lưu thông tin người gửi/nhận tạm thời trên server (qua middleware kiểm tra đầy đủ & hợp lệ)
router.post("/save-info", validateOrderInfo, orderController.savePendingOrder);

// Tạo đơn hàng mới và chỉ định ngăn tủ trống
router.post("/create", orderController.createOrder);

// Đóng tủ sau khi bỏ hàng
router.post("/close-locker", orderController.closeLocker);

module.exports = router;
