const lockerService = require("../services/locker.service");
const orderService = require("../services/order.service");
const mqttService = require("../services/mqtt.service");

/**
 * GET /api/lockers/check
 * Kiểm tra xem có khay tủ nào trống và trả về ID khay tủ trống đầu tiên
 */
async function checkAvailable(req, res, next) {
    try {
        const trong = await lockerService.checkAvailable();
        const availableLockerId = await lockerService.findFirstAvailableLocker();
        const lockers = await lockerService.getAllLockers();

        return res.json({
            trong,
            availableLockerId,
            lockers
        });
    } catch (error) {
        next(error);
    }
}

/**
 * POST /api/lockers/open
 * Mở khay tủ trống: Server tự động kiểm tra khay trống và gửi lệnh mở qua MQTT.
 * Client không có quyền quyết định ID tủ.
 */
async function openLocker(req, res, next) {
    try {
        // Server tự tìm khay trống đầu tiên trong CSDL
        const lockerId = await lockerService.findFirstAvailableLocker();

        if (!lockerId) {
            return res.status(400).json({
                success: false,
                message: "Không tìm thấy khay tủ trống nào để mở"
            });
        }

        const numericLockerId = parseInt(lockerId, 10);

        // Ghi nhận khay đang mở trên server
        orderService.setCurrentlyOpenLocker({ lockerId: numericLockerId });

        // Truyền lệnh tới ESP32 qua MQTT để mở tủ
        await mqttService.openLocker(numericLockerId);

        return res.status(200).json({
            success: true,
            lockerId: numericLockerId,
            message: `Server đã tự động tìm thấy khay trống ${numericLockerId} và truyền lệnh mở tới ESP32.`
        });
    } catch (error) {
        next(error);
    }
}

/**
 * POST /api/lockers/close
 * Đóng khay tủ: Server tự động kiểm tra xem khay nào đang được mở và gửi lệnh đóng qua MQTT.
 * Client không truyền ID tủ.
 */
async function closeLocker(req, res, next) {
    try {
        // 1. Server tự động kiểm tra khay nào đang được mở
        let activeLocker = await orderService.findActiveOpenLocker();
        let targetLockerId = activeLocker ? activeLocker.lockerId : null;

        if (!targetLockerId) {
            targetLockerId = mqttService.getCurrentlyOpenLockerId();
        }

        if (!targetLockerId) {
            const espStatus = mqttService.getEspStatus();
            if (espStatus && espStatus.currentTray && espStatus.door === "OPEN") {
                targetLockerId = espStatus.currentTray;
            }
        }

        if (!targetLockerId) {
            return res.status(400).json({
                success: false,
                message: "Không tìm thấy khay tủ nào đang được mở để đóng"
            });
        }

        const numericLockerId = parseInt(targetLockerId, 10);

        // 2. Cập nhật trạng thái khay trong CSDL
        await lockerService.updateLockerStatus(numericLockerId, false);
        if (activeLocker && activeLocker.orderCode) {
            await orderService.completeDeposit(numericLockerId, activeLocker.orderCode);
        } else {
            orderService.clearCurrentlyOpenLocker();
        }

        // 3. Truyền lệnh đóng tủ tới ESP32 qua MQTT
        await mqttService.closeLocker(numericLockerId);

        return res.status(200).json({
            success: true,
            lockerId: numericLockerId,
            message: `Server đã xác định khay số ${numericLockerId} đang mở và gửi lệnh đóng tới ESP32 qua MQTT.`
        });
    } catch (error) {
        next(error);
    }
}

/**
 * GET /api/lockers/status
 * Lấy trạng thái kết nối MQTT và trạng thái ngoại vi ESP32
 */
async function getStatus(req, res, next) {
    try {
        const activeLocker = await orderService.findActiveOpenLocker();
        return res.status(200).json({
            success: true,
            mqttConnected: mqttService.isConnected(),
            espStatus: mqttService.getEspStatus(),
            currentlyOpenLocker: activeLocker
        });
    } catch (error) {
        next(error);
    }
}

module.exports = {
    checkAvailable,
    openLocker,
    closeLocker,
    getStatus
};
