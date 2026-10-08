/**
 * ==============================================================================
 * Hệ thống Smart Locker - NCKH
 * File: src/config/constants.js
 * Mô tả: Khai báo các giá trị hằng số dùng chung toàn hệ thống backend:
 *        - Trạng thái đơn hàng (khớp với CSDL MySQL)
 *        - Cấu hình & trạng thái ngăn tủ
 *        - Loại thiết bị & trạng thái kết nối
 *        - Quy trình xác thực eKYC
 *        - Tên sự kiện WebSocket thời gian thực
 *        - Mã lỗi nghiệp vụ chuẩn hóa (Error Codes)
 *        - Mã trạng thái HTTP (HTTP Status Codes)
 * ==============================================================================
 */

/**
 * Trạng thái đơn hàng trong bảng DON_HANG (TRANG_THAI: 0 -> 3)
 */
const ORDER_STATUS = Object.freeze({
    /** Đơn hàng mới khởi tạo, chờ người gửi đặt đồ vào khay tủ và đóng cửa */
    PENDING_DEPOSIT: 0,

    /** Người gửi đã đặt hàng vào tủ, cửa tủ đã đóng, hàng đang được lưu trữ */
    STORED: 1,

    /** Người nhận đã xác thực/nhập mã thành công và lấy hàng ra khỏi tủ */
    COMPLETED: 2,

    /** Giao dịch bị hủy bỏ trước hoặc trong quá trình thực hiện */
    CANCELLED: 3
});

/**
 * Nhãn hiển thị mô tả trạng thái đơn hàng (tiếng Việt)
 */
const ORDER_STATUS_LABELS = Object.freeze({
    [ORDER_STATUS.PENDING_DEPOSIT]: "Chờ gửi vào tủ",
    [ORDER_STATUS.STORED]: "Đang lưu trong tủ",
    [ORDER_STATUS.COMPLETED]: "Đã nhận hàng",
    [ORDER_STATUS.CANCELLED]: "Đã hủy giao dịch"
});

/**
 * Cấu hình hệ thống ngăn tủ (Hardware: 6 ngăn tủ)
 */
const LOCKER_CONFIG = Object.freeze({
    TOTAL_LOCKERS: 6,
    MIN_ID: 1,
    MAX_ID: 6
});

/**
 * Trạng thái khay tủ trong bảng TU (TRONG: BOOLEAN / TINYINT)
 */
const LOCKER_STATE = Object.freeze({
    /** Khay tủ đang rỗng, sẵn sàng tiếp nhận đơn mới (TRONG = 1) */
    EMPTY: true,

    /** Khay tủ đang chứa đồ, không được gán cho đơn khác (TRONG = 0) */
    OCCUPIED: false
});

/**
 * Phân loại các thiết bị và thành phần kết nối tới hệ thống
 */
const DEVICE_TYPE = Object.freeze({
    /** ESP32-CAM phục vụ truyền luồng video và chụp ảnh eKYC */
    ESP32_CAM: "esp32_cam",

    /** ESP32 Điều khiển cơ cấu chấp hành (Khóa chốt servo/động cơ, cảm biến hành trình) */
    ESP32_CONTROL: "esp32_control",

    /** Giao diện Kiosk tương tác người dùng (Frontend Web) */
    KIOSK_FE: "kiosk_fe",

    /** Module trí tuệ nhân tạo Python AI Server (FastAPI) */
    AI_SERVICE: "ai_service"
});

/**
 * Trạng thái hoạt động của thiết bị phần cứng
 */
const DEVICE_STATUS = Object.freeze({
    ONLINE: "online",
    OFFLINE: "offline",
    BUSY: "busy",
    ERROR: "error"
});

/**
 * Kết quả thẩm định sinh trắc học khuôn mặt eKYC
 */
const EKYC_VERDICT = Object.freeze({
    APPROVED: "APPROVED",
    REJECTED: "REJECTED",
    PENDING: "PENDING"
});

/**
 * Mã chi tiết lý do từ chối eKYC (Chống giả mạo / Liveness / Pose)
 */
const EKYC_REASONS = Object.freeze({
    SPOOF_DETECTED: "SPOOF_DETECTED",
    NO_FACE: "NO_FACE",
    MULTIPLE_FACES: "MULTIPLE_FACES",
    OCCLUSION_DETECTED: "OCCLUSION_DETECTED",
    BLINK_FAILED: "BLINK_FAILED",
    HEAD_TURN_FAILED: "HEAD_TURN_FAILED",
    POSE_OUT_OF_BOUNDS: "POSE_OUT_OF_BOUNDS",
    IDENTITY_MISMATCH: "IDENTITY_MISMATCH",
    QUALITY_TOO_LOW: "QUALITY_TOO_LOW"
});

/**
 * Các sự kiện giao tiếp WebSocket thời gian thực
 */
const WS_EVENTS = Object.freeze({
    CONNECTION: "connection",
    DISCONNECT: "disconnect",

    // Lệnh điều khiển và phản hồi tủ đồ
    OPEN_LOCKER: "OPEN_LOCKER",
    LOCKER_OPENED: "LOCKER_OPENED",
    LOCKER_CLOSED: "LOCKER_CLOSED",

    // Luồng video và sự kiện sinh trắc học eKYC
    STREAM_FRAME: "STREAM_FRAME",
    FACE_VERIFIED: "FACE_VERIFIED",

    // Trạng thái thiết bị và cập nhật đơn hàng
    DEVICE_STATUS: "DEVICE_STATUS",
    ORDER_UPDATED: "ORDER_UPDATED",

    // Heartbeat
    PING: "PING",
    PONG: "PONG"
});

/**
 * Mã lỗi nghiệp vụ chuẩn hóa (Business Error Codes)
 */
const ERROR_CODES = Object.freeze({
    // Lỗi dữ liệu đầu vào
    VALIDATION_ERROR: "VALIDATION_ERROR",
    MISSING_REQUIRED_FIELDS: "MISSING_REQUIRED_FIELDS",
    INVALID_PHONE_NUMBER: "INVALID_PHONE_NUMBER",

    // Lỗi liên quan đến ngăn tủ
    LOCKER_FULL: "LOCKER_FULL",
    LOCKER_NOT_FOUND: "LOCKER_NOT_FOUND",
    LOCKER_OCCUPIED: "LOCKER_OCCUPIED",
    LOCKER_OPEN_FAILED: "LOCKER_OPEN_FAILED",

    // Lỗi liên quan đến đơn hàng
    ORDER_NOT_FOUND: "ORDER_NOT_FOUND",
    ORDER_ALREADY_EXISTS: "ORDER_ALREADY_EXISTS",
    ORDER_INVALID_STATE: "ORDER_INVALID_STATE",

    // Lỗi eKYC & Thiết bị
    EKYC_FAILED: "EKYC_FAILED",
    DEVICE_OFFLINE: "DEVICE_OFFLINE",
    AI_SERVICE_UNAVAILABLE: "AI_SERVICE_UNAVAILABLE",

    // Quyền truy cập & Hệ thống
    UNAUTHORIZED: "UNAUTHORIZED",
    FORBIDDEN: "FORBIDDEN",
    NOT_FOUND: "NOT_FOUND",
    INTERNAL_SERVER_ERROR: "INTERNAL_SERVER_ERROR"
});

/**
 * Mã trạng thái HTTP chuẩn hóa
 */
const HTTP_STATUS = Object.freeze({
    OK: 200,
    CREATED: 201,
    ACCEPTED: 202,
    NO_CONTENT: 204,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    UNPROCESSABLE_ENTITY: 422,
    INTERNAL_SERVER_ERROR: 500,
    SERVICE_UNAVAILABLE: 503
});

module.exports = {
    ORDER_STATUS,
    ORDER_STATUS_LABELS,
    LOCKER_CONFIG,
    LOCKER_STATE,
    DEVICE_TYPE,
    DEVICE_STATUS,
    EKYC_VERDICT,
    EKYC_REASONS,
    WS_EVENTS,
    ERROR_CODES,
    HTTP_STATUS
};
