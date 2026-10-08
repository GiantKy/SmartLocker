const { ERROR_CODES, HTTP_STATUS } = require("../config/constants");

/**
 * Middleware kiểm tra tính đầy đủ và hợp lệ của thông tin người gửi & người nhận
 * - Đảm bảo các trường bắt buộc không được để trống: senderName, senderPhone, receiverName, receiverPhone
 * - Kiểm tra định dạng số điện thoại hợp lệ (chuẩn Việt Nam: 9-11 số, bắt đầu bằng 0 hoặc +84)
 * - Tự động chuẩn hóa (trim khoảng trắng thừa) dữ liệu
 */
function validateOrderInfo(req, res, next) {
    const { senderName, senderPhone, receiverName, receiverPhone } = req.body || {};

    const cleanSenderName = typeof senderName === "string" ? senderName.trim() : "";
    const cleanSenderPhone = typeof senderPhone === "string" ? senderPhone.trim().replace(/\s+/g, "") : "";
    const cleanReceiverName = typeof receiverName === "string" ? receiverName.trim() : "";
    const cleanReceiverPhone = typeof receiverPhone === "string" ? receiverPhone.trim().replace(/\s+/g, "") : "";

    // 1. Kiểm tra tính đầy đủ của thông tin
    if (!cleanSenderName || !cleanSenderPhone || !cleanReceiverName || !cleanReceiverPhone) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
            success: false,
            code: ERROR_CODES.MISSING_REQUIRED_FIELDS,
            message: "Vui lòng nhập đầy đủ tên và số điện thoại của cả người gửi và người nhận"
        });
    }

    // 2. Kiểm tra tính hợp lệ của số điện thoại (Việt Nam)
    const phoneRegex = /^(0|\+84)[0-9]{8,10}$/;
    if (!phoneRegex.test(cleanSenderPhone) || !phoneRegex.test(cleanReceiverPhone)) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
            success: false,
            code: ERROR_CODES.INVALID_PHONE_NUMBER,
            message: "Số điện thoại không hợp lệ (gồm 9-11 chữ số, bắt đầu bằng 0 hoặc +84)"
        });
    }

    // Gán lại dữ liệu đã làm sạch vào req.body để controller sử dụng
    req.body.senderName = cleanSenderName;
    req.body.senderPhone = cleanSenderPhone;
    req.body.receiverName = cleanReceiverName;
    req.body.receiverPhone = cleanReceiverPhone;

    next();
}

module.exports = {
    validateOrderInfo
};
