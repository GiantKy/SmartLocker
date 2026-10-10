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
 * Ghi nhận ngăn tủ đang được mở trên server
 * @param {Object} param0 
 * @param {number} param0.lockerId
 * @param {string} [param0.orderCode]
 */
function setCurrentlyOpenLocker({ lockerId, orderCode }) {
    currentlyOpenLocker = {
        lockerId: parseInt(lockerId, 10),
        orderCode: orderCode || null,
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
 * @returns {Promise<{ lockerId: number, orderCode: string|null }|null>}
 */
async function findActiveOpenLocker() {
    if (currentlyOpenLocker && currentlyOpenLocker.lockerId) {
        return currentlyOpenLocker;
    }

    // Truy vấn đơn hàng đang trong tiến trình mở tủ (TRANG_THAI = 0)
    const rows = await query(
        "SELECT TU, MA_DON_HANG FROM DON_HANG WHERE TRANG_THAI = 0 ORDER BY ID DESC LIMIT 1"
    );
    if (rows.length > 0) {
        const found = {
            lockerId: rows[0].TU,
            orderCode: rows[0].MA_DON_HANG
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
    // Sinh mã đơn hàng ngẫu nhiên duy nhất (VD: DH738192)
    const randomSuffix = Math.floor(100000 + Math.random() * 900000);
    const orderCode = `DH${randomSuffix}`;

    const sql = `
        INSERT INTO DON_HANG 
        (TU, MA_DON_HANG, TEN_NGUOI_GUI, SDT_NGUOI_GUI, TEN_NGUOI_NHAN, SDT_NGUOI_NHAN, TRANG_THAI)
        VALUES (?, ?, ?, ?, ?, ?, 0)
    `;

    await query(sql, [
        lockerId,
        orderCode,
        senderName,
        senderPhone,
        receiverName,
        receiverPhone
    ]);

    // Xóa thông tin tạm sau khi đã ghi thành công vào database
    clearPendingOrder();

    // Ghi nhận ngăn tủ này hiện đang được mở
    setCurrentlyOpenLocker({ lockerId, orderCode });

    return {
        orderCode,
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
 * 2. Cập nhật trạng thái đơn hàng thành 1 (Đã gửi vào tủ)
 * @param {number} lockerId 
 * @param {string} [orderCode]
 * @returns {Promise<boolean>}
 */
async function completeDeposit(lockerId, orderCode) {
    // Cập nhật trạng thái tủ thành đã có hàng
    await query("UPDATE TU SET TRONG = 0 WHERE ID = ?", [lockerId]);

    // Cập nhật trạng thái đơn hàng sang 1 (đã gửi vào tủ)
    if (orderCode) {
        await query("UPDATE DON_HANG SET TRANG_THAI = 1 WHERE MA_DON_HANG = ?", [orderCode]);
    } else {
        await query(
            "UPDATE DON_HANG SET TRANG_THAI = 1 WHERE TU = ? ORDER BY ID DESC LIMIT 1",
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
    completeDeposit
};
