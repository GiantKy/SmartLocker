const { query } = require("../config/database");

// Lưu trữ thông tin đơn hàng tạm thời (người gửi, người nhận) trên server
let pendingOrder = null;

// Lưu trữ thông tin ngăn tủ đang mở trên server
let currentlyOpenLocker = null; // { lockerId, orderCode, openedAt }

/**
 * Lưu thông tin người gửi & người nhận tạm thời trên server
 * @param {Object} data 
 * @param {string} data.senderName
 * @param {string} data.senderPhone
 * @param {string} data.receiverName
 * @param {string} data.receiverPhone
 * @returns {Object}
 */
function setPendingOrder({ senderName, senderPhone, receiverName, receiverPhone }) {
    pendingOrder = {
        senderName,
        senderPhone,
        receiverName,
        receiverPhone,
        updatedAt: new Date()
    };
    return pendingOrder;
}

/**
 * Lấy thông tin người gửi & người nhận đang lưu tạm trên server
 * @returns {Object|null}
 */
function getPendingOrder() {
    return pendingOrder;
}

/**
 * Xóa thông tin đơn hàng tạm thời trên server
 */
function clearPendingOrder() {
    pendingOrder = null;
}

/**
/**
 * Ghi nhận ngăn tủ đang được mở trên server
 * @param {Object} param0 
 * @param {number} param0.lockerId
 * @param {string} [param0.orderCode]
 * @param {string} [param0.action] "DEPOSIT" hoặc "RECEIVE"
 * @param {number} [param0.orderId]
 */
function setCurrentlyOpenLocker({ lockerId, orderCode, action = "DEPOSIT", orderId = null }) {
    currentlyOpenLocker = {
        lockerId: parseInt(lockerId, 10),
        orderCode: orderCode || null,
        action: action ? action.toUpperCase() : "DEPOSIT",
        orderId: orderId || null,
        openedAt: new Date()
    };
    return currentlyOpenLocker;
}

/**
 * Lấy thông tin ngăn tủ đang mở trong bộ nhớ server
 * @returns {Object|null}
 */
function getCurrentlyOpenLocker() {
    return currentlyOpenLocker;
}

/**
 * Xóa trạng thái ngăn tủ đang mở
 */
function clearCurrentlyOpenLocker() {
    currentlyOpenLocker = null;
}

/**
 * Tự động tìm ngăn tủ đang mở:
 * 1. Kiểm tra bộ nhớ cache server
 * 2. Nếu không có, truy vấn đơn hàng gần nhất có TRANG_THAI = 0 trong CSDL
 * @returns {Promise<{ lockerId: number, orderCode: string|null, action: string }|null>}
 */
async function findActiveOpenLocker() {
    if (currentlyOpenLocker && currentlyOpenLocker.lockerId) {
        return currentlyOpenLocker;
    }

    // Truy vấn đơn hàng đang trong tiến trình mở tủ gửi hàng (TRANG_THAI = 0)
    const rows = await query(
        "SELECT TU, MA_DON_HANG FROM DON_HANG WHERE TRANG_THAI = 0 ORDER BY ID DESC LIMIT 1"
    );
    if (rows.length > 0) {
        const found = {
            lockerId: rows[0].TU,
            orderCode: rows[0].MA_DON_HANG,
            action: "DEPOSIT"
        };
        setCurrentlyOpenLocker(found);
        return found;
    }

    return null;
}

/**
 * Tìm kiếm khay tủ trống đầu tiên để chỉ định cho đơn hàng
 * @returns {Promise<number|null>} ID tủ trống (1 -> 6) hoặc null nếu hết tủ
 */
async function assignAvailableLocker() {
    const rows = await query("SELECT ID FROM TU WHERE TRONG = 1 ORDER BY ID ASC LIMIT 1");
    if (rows.length > 0) {
        return rows[0].ID;
    }
    return null;
}

/**
 * Tạo đơn hàng mới trong CSDL và gán vào tủ
 * @param {Object} data 
 * @param {string} data.senderName
 * @param {string} data.senderPhone
 * @param {string} data.receiverName
 * @param {string} data.receiverPhone
 * @param {number} data.lockerId
 * @returns {Promise<Object>}
 */
async function createOrder({ senderName, senderPhone, receiverName, receiverPhone, lockerId }) {
    // Sinh mã OTP 6 chữ số ngẫu nhiên duy nhất
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const orderCode = `DH${otp}`;

    // Thử chèn bản ghi kèm cột OTP
    try {
        const sql = `
            INSERT INTO DON_HANG 
            (TU, MA_DON_HANG, OTP, TEN_NGUOI_GUI, SDT_NGUOI_GUI, TEN_NGUOI_NHAN, SDT_NGUOI_NHAN, TRANG_THAI)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0)
        `;
        await query(sql, [
            lockerId,
            orderCode,
            otp,
            senderName,
            senderPhone,
            receiverName,
            receiverPhone
        ]);
    } catch (insertErr) {
        // Fallback nếu CSDL chưa có cột OTP
        const fallbackSql = `
            INSERT INTO DON_HANG 
            (TU, MA_DON_HANG, TEN_NGUOI_GUI, SDT_NGUOI_GUI, TEN_NGUOI_NHAN, SDT_NGUOI_NHAN, TRANG_THAI)
            VALUES (?, ?, ?, ?, ?, ?, 0)
        `;
        await query(fallbackSql, [
            lockerId,
            orderCode,
            senderName,
            senderPhone,
            receiverName,
            receiverPhone
        ]);
    }

    // Xóa thông tin tạm sau khi đã ghi thành công vào database
    clearPendingOrder();

    // Ghi nhận ngăn tủ này hiện đang được mở phục vụ gửi hàng
    setCurrentlyOpenLocker({ lockerId, orderCode, action: "DEPOSIT" });

    return {
        orderCode,
        otp,
        lockerId,
        senderName,
        senderPhone,
        receiverName,
        receiverPhone,
        status: 0
    };
}

/**
 * Đóng tủ sau khi người dùng đã bỏ hàng vào ngăn tủ:
 * 1. Đánh dấu tủ không còn trống (TRONG = 0 / FALSE)
 * 2. Cập nhật trạng thái đơn hàng thành 1 (Đã gửi vào tủ - STORED)
 * @param {number} lockerId 
 * @param {string} [orderCode]
 * @returns {Promise<boolean>}
 */
async function completeDeposit(lockerId, orderCode) {
    // Cập nhật trạng thái tủ thành đã có hàng
    await query("UPDATE TU SET TRONG = 0 WHERE ID = ?", [lockerId]);

    // Cập nhật trạng thái đơn hàng sang 1 (đã gửi vào tủ, chờ người nhận)
    if (orderCode) {
        await query("UPDATE DON_HANG SET TRANG_THAI = 1 WHERE MA_DON_HANG = ?", [orderCode]);
    } else {
        await query(
            "UPDATE DON_HANG SET TRANG_THAI = 1 WHERE TU = ? AND TRANG_THAI = 0 ORDER BY ID DESC LIMIT 1",
            [lockerId]
        );
    }

    clearPendingOrder();
    clearCurrentlyOpenLocker();
    return true;
}

/**
 * Xác thực thông tin và tìm kiếm đơn hàng đang chờ nhận trong tủ (TRANG_THAI = 1)
 * @param {Object} param0 
 * @param {string} param0.receivePhone SĐT người nhận
 * @param {string} param0.receiveOtp Mã OTP hoặc mã đơn hàng
 * @returns {Promise<Object|null>}
 */
async function verifyAndFindOrderForPickup({ receivePhone, receiveOtp }) {
    const cleanPhone = String(receivePhone || "").trim().replace(/\s+/g, "");
    const cleanOtp = String(receiveOtp || "").trim().toUpperCase();

    // Tạo biến thể số điện thoại để hỗ trợ cả 098... lẫn +8498...
    let altPhone = cleanPhone;
    if (cleanPhone.startsWith("+84")) {
        altPhone = "0" + cleanPhone.substring(3);
    } else if (cleanPhone.startsWith("84")) {
        altPhone = "0" + cleanPhone.substring(2);
    } else if (cleanPhone.startsWith("0")) {
        altPhone = "+84" + cleanPhone.substring(1);
    }

    // Câu lệnh SQL linh hoạt:
    // - Khớp SĐT người nhận (hoặc người gửi dự phòng)
    // - TRANG_THAI = 1 (đang lưu trữ trong tủ, chờ nhận)
    // - Khớp trực tiếp cột OTP, hoặc mã đơn MA_DON_HANG, hoặc tiền tố DH
    const sql = `
        SELECT ID, TU, MA_DON_HANG, OTP, TEN_NGUOI_GUI, SDT_NGUOI_GUI, TEN_NGUOI_NHAN, SDT_NGUOI_NHAN, TRANG_THAI, CREATED_AT
        FROM DON_HANG
        WHERE (SDT_NGUOI_NHAN = ? OR SDT_NGUOI_NHAN = ? OR SDT_NGUOI_GUI = ? OR SDT_NGUOI_GUI = ?)
          AND TRANG_THAI = 1
          AND (
            OTP = ?
            OR MA_DON_HANG = ?
            OR MA_DON_HANG = CONCAT('DH', ?)
            OR ? = CONCAT('DH', OTP)
          )
        ORDER BY ID DESC
        LIMIT 1
    `;

    try {
        const rows = await query(sql, [
            cleanPhone,
            altPhone,
            cleanPhone,
            altPhone,
            cleanOtp,
            cleanOtp,
            cleanOtp,
            cleanOtp
        ]);

        if (rows && rows.length > 0) {
            return rows[0];
        }
    } catch (queryErr) {
        // Fallback nếu cột OTP chưa có
        const fallbackSql = `
            SELECT ID, TU, MA_DON_HANG, TEN_NGUOI_GUI, SDT_NGUOI_GUI, TEN_NGUOI_NHAN, SDT_NGUOI_NHAN, TRANG_THAI, CREATED_AT
            FROM DON_HANG
            WHERE (SDT_NGUOI_NHAN = ? OR SDT_NGUOI_NHAN = ? OR SDT_NGUOI_GUI = ? OR SDT_NGUOI_GUI = ?)
              AND TRANG_THAI = 1
              AND (
                MA_DON_HANG = ?
                OR MA_DON_HANG = CONCAT('DH', ?)
              )
            ORDER BY ID DESC
            LIMIT 1
        `;
        const rows = await query(fallbackSql, [
            cleanPhone,
            altPhone,
            cleanPhone,
            altPhone,
            cleanOtp,
            cleanOtp
        ]);
        if (rows && rows.length > 0) {
            return rows[0];
        }
    }

    return null;
}

/**
 * Bắt đầu phiên nhận hàng: ghi nhận ngăn tủ đang mở phục vụ phiên RECEIVE
 * @param {Object} order 
 */
function startPickup(order) {
    const lockerId = parseInt(order.TU, 10);
    const orderCode = order.MA_DON_HANG;
    setCurrentlyOpenLocker({
        lockerId,
        orderCode,
        action: "RECEIVE",
        orderId: order.ID
    });
    return currentlyOpenLocker;
}

/**
 * Hoàn tất quy trình nhận hàng sau khi người nhận đã lấy đồ và ấn đóng cửa tủ:
 * 1. Giải phóng ngăn tủ thành TRỐNG (TRONG = 1 / TRUE)
 * 2. Cập nhật trạng thái đơn hàng thành 2 (COMPLETED - Đã nhận hàng thành công)
 * @param {number} lockerId 
 * @param {string} [orderCode]
 * @returns {Promise<boolean>}
 */
async function completePickup(lockerId, orderCode) {
    // 1. Giải phóng ngăn tủ thành trống để nhận đơn mới
    await query("UPDATE TU SET TRONG = 1 WHERE ID = ?", [lockerId]);

    // 2. Cập nhật trạng thái đơn hàng sang 2 (COMPLETED - Đã nhận hàng)
    if (orderCode) {
        await query("UPDATE DON_HANG SET TRANG_THAI = 2 WHERE MA_DON_HANG = ?", [orderCode]);
    } else {
        await query(
            "UPDATE DON_HANG SET TRANG_THAI = 2 WHERE TU = ? AND TRANG_THAI = 1 ORDER BY ID DESC LIMIT 1",
            [lockerId]
        );
    }

    clearPendingOrder();
    clearCurrentlyOpenLocker();
    return true;
}

module.exports = {
    setPendingOrder,
    getPendingOrder,
    clearPendingOrder,
    setCurrentlyOpenLocker,
    getCurrentlyOpenLocker,
    clearCurrentlyOpenLocker,
    findActiveOpenLocker,
    assignAvailableLocker,
    createOrder,
    completeDeposit,
    verifyAndFindOrderForPickup,
    startPickup,
    completePickup
};
