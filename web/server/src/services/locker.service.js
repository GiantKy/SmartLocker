const { query } = require("../config/database");

/**
 * Kiểm tra xem có khay tủ nào trống hay không
 * @returns {Promise<boolean>}
 */
async function checkAvailable() {
    const rows = await query("SELECT 1 FROM TU WHERE TRONG = 1 LIMIT 1");
    return rows.length > 0;
}

module.exports = {
    checkAvailable
};
