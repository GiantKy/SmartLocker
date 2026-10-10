const { query } = require("../config/database");

/**
 * Kiểm tra xem có khay tủ nào trống hay không
 * @returns {Promise<boolean>}
 */
async function checkAvailable() {
    const rows = await query("SELECT 1 FROM TU WHERE TRONG = 1 LIMIT 1");
    return rows.length > 0;
}

/**
 * Tìm khay tủ trống đầu tiên
 * @returns {Promise<number|null>}
 */
async function findFirstAvailableLocker() {
    const rows = await query("SELECT ID FROM TU WHERE TRONG = 1 ORDER BY ID ASC LIMIT 1");
    return rows.length > 0 ? rows[0].ID : null;
}

/**
 * Lấy danh sách tất cả các khay tủ và trạng thái
 * @returns {Promise<Array>}
 */
async function getAllLockers() {
    return await query("SELECT ID, TRONG FROM TU ORDER BY ID ASC");
}

/**
 * Lấy thông tin chi tiết một khay tủ
 * @param {number} id
 * @returns {Promise<Object|null>}
 */
async function getLockerById(id) {
    const rows = await query("SELECT ID, TRONG FROM TU WHERE ID = ? LIMIT 1", [id]);
    return rows.length > 0 ? rows[0] : null;
}

/**
 * Cập nhật trạng thái trống / đầy của một khay tủ
 * @param {number} id 
 * @param {boolean} trong 
 * @returns {Promise<boolean>}
 */
async function updateLockerStatus(id, trong) {
    await query("UPDATE TU SET TRONG = ? WHERE ID = ?", [trong ? 1 : 0, id]);
    return true;
}

module.exports = {
    checkAvailable,
    findFirstAvailableLocker,
    getAllLockers,
    getLockerById,
    updateLockerStatus
};
