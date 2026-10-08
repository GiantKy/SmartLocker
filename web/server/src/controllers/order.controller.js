const orderService = require("../services/order.service");
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
 * Tạo đơn hàng và gán ngăn tủ trống
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
            }
        }

        if (!senderName || !senderPhone || !receiverName || !receiverPhone) {
            return res.status(400).json({
                success: false,
                message: "Thiếu thông tin người gửi hoặc người nhận"
            });
        }

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

        return res.status(200).json({
            success: true,
            order
        });
    } catch (error) {
        next(error);
    }
}

/**
 * Đóng tủ sau khi người dùng đã bỏ hàng
 * POST /api/orders/close-locker
 */
async function closeLocker(req, res, next) {
    try {
        const { lockerId, orderCode } = req.body;

        if (!lockerId) {
            return res.status(400).json({
                success: false,
                message: "Thiếu ID ngăn tủ cần đóng"
            });
        }

        await orderService.completeDeposit(parseInt(lockerId, 10), orderCode);

        // Reset trạng thái server về trang chủ khi giao dịch hoàn tất
        if (typeof resetPageToHome === "function") {
            resetPageToHome();
        }

        return res.status(200).json({
            success: true,
            message: `Ngăn tủ số ${lockerId} đã đóng thành công`
        });
    } catch (error) {
        next(error);
    }
}

module.exports = {
    savePendingOrder,
    createOrder,
    closeLocker
};
