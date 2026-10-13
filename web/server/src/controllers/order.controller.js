const orderService = require("../services/order.service");
const mqttService = require("../services/mqtt.service");
const { resetPageToHome } = require("../routes/page.routes");

/**
 * Lưu thông tin người gửi và người nhận tạm thời trên server
 * POST /api/orders/save-info
 */
async function savePendingOrder(req, res, next) {
    try {
        // Dữ liệu đã được kiểm tra tính đầy đủ & hợp lệ qua middleware validateOrderInfo
        const { senderName, senderPhone, receiverName, receiverPhone } = req.body;

        const saved = orderService.setPendingOrder({
            senderName,
            senderPhone,
            receiverName,
            receiverPhone
        });

        return res.status(200).json({
            success: true,
            message: "Lưu thông tin thành công."
        });
    } catch (error) {
        next(error);
    }
}

/**
 * Lấy thông tin người gửi & người nhận đang lưu tạm trên server
 * GET /api/orders/pending
 */
async function getPendingOrder(req, res, next) {
    try {
        const pending = orderService.getPendingOrder();
        return res.status(200).json({
            success: true,
            pendingOrder: pending
        });
    } catch (error) {
        next(error);
    }
}

/**
 * Tạo đơn hàng và gán ngăn tủ trống:
 * Server tự động tìm khay trống và truyền lệnh mở tủ về ESP32 qua MQTT.
 * Client không có quyền chỉ định ID khay tủ.
 * POST /api/orders/create
 */
async function createOrder(req, res, next) {
    try {
        let { senderName, senderPhone, receiverName, receiverPhone } = req.body || {};

        // Nếu client không gửi thông tin trong body, tự động lấy thông tin đã lưu trên server
        if (!senderName || !senderPhone || !receiverName || !receiverPhone) {
            const pending = orderService.getPendingOrder();
            if (pending) {
                senderName = pending.senderName;
                senderPhone = pending.senderPhone;
                receiverName = pending.receiverName;
                receiverPhone = pending.receiverPhone;
            } else {
                // Fallback mặc định khi người dùng vào thẳng trang /locker
                senderName = "Khách Hàng Trực Tiếp";
                senderPhone = "0988888888";
                receiverName = "Người Nhận";
                receiverPhone = "0977777777";
            }
        }

        // Server tự kiểm tra và chọn khay trống đầu tiên
        const lockerId = await orderService.assignAvailableLocker();
        if (!lockerId) {
            return res.status(400).json({
                success: false,
                message: "Hiện tại tất cả các khay tủ đều đã đầy"
            });
        }

        const order = await orderService.createOrder({
            senderName,
            senderPhone,
            receiverName,
            receiverPhone,
            lockerId
        });

        // TRUYỀN LỆNH MỞ TỦ VỀ ESP32 QUA MQTT
        try {
            await mqttService.openLocker(lockerId);
            console.log(`[OrderController] Đã gửi lệnh mở khay tủ số ${lockerId} tới ESP32 qua MQTT thành công.`);
        } catch (mqttError) {
            console.error(`[OrderController] Lỗi gửi lệnh MQTT mở tủ ${lockerId}:`, mqttError.message);
        }

        return res.status(200).json({
            success: true,
            order
        });
    } catch (error) {
        next(error);
    }
}

/**
 * Đóng tủ sau khi người dùng ấn nút "Đóng tủ":
 * Server tự động xem khay nào đang được mở để đóng.
/**
 * Xác thực thông tin người nhận (SĐT + OTP) và mở khay tủ tương ứng:
 * POST /api/orders/receive
 */
async function receiveOrder(req, res, next) {
    try {
        const { receivePhone, receiveOtp } = req.body || {};

        if (!receivePhone || !receiveOtp) {
            return res.status(400).json({
                success: false,
                message: "Vui lòng nhập đầy đủ SĐT người nhận và mã OTP nhận hàng"
            });
        }

        // Tra cứu đơn hàng hợp lệ trong CSDL (TRANG_THAI = 1)
        const order = await orderService.verifyAndFindOrderForPickup({ receivePhone, receiveOtp });
        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Không tìm thấy kiện hàng nào khớp với số điện thoại và mã OTP này, hoặc kiện hàng đã được nhận trước đó."
            });
        }

        const lockerId = parseInt(order.TU, 10);
        const orderCode = order.MA_DON_HANG;

        // Bắt đầu phiên nhận hàng trên server
        orderService.startPickup(order);

        // TRUYỀN LỆNH MỞ TỦ VỀ ESP32 QUA MQTT
        try {
            await mqttService.openLocker(lockerId, {
                action: "RECEIVE",
                orderCode: orderCode,
                receiverPhone: order.SDT_NGUOI_NHAN
            });
            console.log(`[OrderController] Đã gửi lệnh mở khay tủ số ${lockerId} cho người nhận lấy hàng (${orderCode}) qua MQTT.`);
        } catch (mqttError) {
            console.error(`[OrderController] Lỗi gửi lệnh MQTT mở tủ ${lockerId}:`, mqttError.message);
        }

        return res.status(200).json({
            success: true,
            message: "Xác thực thành công. Khay tủ đang được mở để lấy hàng.",
            order: {
                orderCode: order.MA_DON_HANG,
                lockerId: lockerId,
                receiverName: order.TEN_NGUOI_NHAN,
                receiverPhone: order.SDT_NGUOI_NHAN,
                createdAt: order.CREATED_AT
            }
        });
    } catch (error) {
        next(error);
    }
}

/**
 * Đóng tủ sau khi người dùng ấn nút "Đóng tủ":
 * Tự động phân biệt luồng GỬI HÀNG (đóng tủ & lưu hàng) và NHẬN HÀNG (đóng tủ & giải phóng khay)
 * POST /api/orders/close-locker
 */
async function closeLocker(req, res, next) {
    try {
        // 1. Server tự động xác định khay nào đang được mở
        let activeLocker = await orderService.findActiveOpenLocker();
        let targetLockerId = activeLocker ? activeLocker.lockerId : null;
        let targetOrderCode = activeLocker ? activeLocker.orderCode : null;
        let activeAction = activeLocker ? activeLocker.action : null;

        // Nếu DB chưa có đơn, kiểm tra trạng thái mở trong MQTT service
        if (!targetLockerId) {
            targetLockerId = mqttService.getCurrentlyOpenLockerId();
        }

        // Nếu vẫn không có, kiểm tra trạng thái từ board ESP32
        if (!targetLockerId) {
            const espStatus = mqttService.getEspStatus();
            if (espStatus && espStatus.currentTray && espStatus.door === "OPEN") {
                targetLockerId = espStatus.currentTray;
            }
        }

        if (!targetLockerId) {
            return res.status(400).json({
                success: false,
                message: "Không tìm thấy ngăn tủ nào đang mở để đóng"
            });
        }

        const numericLockerId = parseInt(targetLockerId, 10);
        const isReceiveAction = (activeAction === "RECEIVE");

        if (isReceiveAction) {
            // 2a. LUỒNG NHẬN HÀNG: Giải phóng khay tủ (TRONG = 1), cập nhật đơn sang COMPLETED (TRANG_THAI = 2)
            await orderService.completePickup(numericLockerId, targetOrderCode);
        } else {
            // 2b. LUỒNG GỬI HÀNG: Đánh dấu tủ đã có hàng (TRONG = 0), cập nhật đơn sang STORED (TRANG_THAI = 1)
            await orderService.completeDeposit(numericLockerId, targetOrderCode);
        }

        // 3. TRUYỀN LỆNH ĐÓNG TỦ VỀ ESP32 QUA MQTT
        try {
            await mqttService.closeLocker(numericLockerId, {
                action: isReceiveAction ? "RECEIVE" : "DEPOSIT",
                orderCode: targetOrderCode
            });
            console.log(`[OrderController] Server xác định khay ${numericLockerId} đang mở (${isReceiveAction ? "RECEIVE" : "DEPOSIT"}) và đã gửi lệnh đóng tới ESP32 qua MQTT.`);
        } catch (mqttError) {
            console.error(`[OrderController] Lỗi gửi lệnh MQTT đóng tủ ${numericLockerId}:`, mqttError.message);
        }

        // Reset trạng thái server về trang chủ khi giao dịch hoàn tất
        if (typeof resetPageToHome === "function") {
            resetPageToHome();
        }

        return res.status(200).json({
            success: true,
            action: isReceiveAction ? "RECEIVE" : "DEPOSIT",
            lockerId: numericLockerId,
            orderCode: targetOrderCode,
            message: isReceiveAction
                ? `Ngăn tủ số ${numericLockerId} đã đóng và giải phóng thành công. Đã hoàn tất nhận hàng!`
                : `Ngăn tủ số ${numericLockerId} đã đóng thành công`
        });
    } catch (error) {
        next(error);
    }
}

/**
 * Lấy thông tin ngăn tủ đang hoạt động (nếu có)
 * GET /api/orders/active
 */
async function getActiveOrder(req, res, next) {
    try {
        const active = await orderService.findActiveOpenLocker();
        return res.status(200).json({
            success: true,
            activeLocker: active
        });
    } catch (error) {
        next(error);
    }
}

module.exports = {
    savePendingOrder,
    getPendingOrder,
    createOrder,
    receiveOrder,
    closeLocker,
    getActiveOrder
};
