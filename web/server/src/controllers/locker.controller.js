const lockerService = require("../services/locker.service");

/**
 * GET /api/lockers/check
 * Trả về còn khay tủ trống hay không
 */
async function checkAvailable(req, res, next) {
    try {
        const trong = await lockerService.checkAvailable();
        return res.json({ trong });
    } catch (error) {
        next(error);
    }
}

module.exports = {
    checkAvailable
};
