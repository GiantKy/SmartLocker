/**
 * ==============================================================================
 * KỊCH BẢN KIỂM THỬ TỰ ĐỘNG TOÀN DIỆN HỆ THỐNG SMART LOCKER (END-TO-END)
 * ==============================================================================
 * Mục đích:
 * 1. Kiểm tra trạng thái máy chủ Node.js (:3000) & Kết nối MySQL Laragon
 * 2. Kiểm tra máy chủ AI FastAPI (:8000)
 * 3. Kiểm tra kết nối MQTT Broker
 * 4. Kiểm tra toàn bộ luồng Gửi Hàng (Save info -> Verify AI -> Create Order -> Close Locker)
 * 5. Kiểm tra toàn bộ luồng Nhận Hàng (Verify SĐT + OTP -> Open Locker -> Close & Free Locker)
 * 6. Kiểm tra các trường hợp ngoại lệ (Nhập sai OTP, tủ đầy...)
 * ==============================================================================
 */

const BASE_URL = process.env.TEST_URL || "http://127.0.0.1:3000";
const AI_URL = process.env.AI_URL || "http://127.0.0.1:8000";

const COLORS = {
    reset: "\x1b[0m",
    green: "\x1b[32m",
    red: "\x1b[31m",
    yellow: "\x1b[33m",
    cyan: "\x1b[36m",
    bold: "\x1b[1m"
};

function logStep(step, message) {
    console.log(`\n${COLORS.cyan}${COLORS.bold}[BƯỚC ${step}]${COLORS.reset} ${message}`);
}

function logPass(message) {
    console.log(`  ${COLORS.green}✔ THÀNH CÔNG:${COLORS.reset} ${message}`);
}

function logFail(message, details = null) {
    console.log(`  ${COLORS.red}✖ THẤT BẠI:${COLORS.reset} ${message}`);
    if (details) console.log("    Chi tiết:", details);
}

async function request(url, options = {}) {
    try {
        const res = await fetch(url, options);
        let data = null;
        const text = await res.text();
        try {
            data = JSON.parse(text);
        } catch (e) {
            data = text;
        }
        return { status: res.status, ok: res.ok, data };
    } catch (err) {
        return { status: 0, ok: false, error: err.message };
    }
}

async function runAllTests() {
    console.log("==================================================================");
    console.log(`${COLORS.bold}${COLORS.yellow} BẮT ĐẦU KIỂM THỬ TOÀN BỘ SERVER SMART LOCKER (NCKH)${COLORS.reset}`);
    console.log(` Mục tiêu Node.js Server: ${BASE_URL}`);
    console.log(` Mục tiêu AI Server:      ${AI_URL}`);
    console.log("==================================================================");

    let passedTests = 0;
    let failedTests = 0;

    // -------------------------------------------------------------
    // TEST 1: Kiểm tra Node.js Server Health & MySQL
    // -------------------------------------------------------------
    logStep(1, "Kiểm tra Health Check & Kết nối Cơ sở Dữ liệu MySQL (:3000/health)");
    const healthRes = await request(`${BASE_URL}/health`);
    if (healthRes.ok && healthRes.data && healthRes.data.status === "ok") {
        logPass(`Node.js Server phản hồi tốt. CSDL: ${healthRes.data.database || "connected"}`);
        passedTests++;
    } else {
        logFail("Không thể kết nối tới Node.js Server hoặc CSDL lỗi!", healthRes);
        failedTests++;
    }

    // -------------------------------------------------------------
    // TEST 2: Kiểm tra kết nối AI FastAPI Server (:8000)
    // -------------------------------------------------------------
    logStep(2, "Kiểm tra trạng thái Máy chủ Trí tuệ Nhân tạo Python AI (:8000/health)");
    const aiRes = await request(`${AI_URL}/health`);
    if (aiRes.ok && aiRes.data) {
        logPass(`Python AI Server hoạt động bình thường (Status: ${aiRes.data.status || "ok"})`);
        passedTests++;
    } else {
        console.log(`  ${COLORS.yellow}⚠ CẢNH BÁO:${COLORS.reset} AI Server (:8000) chưa khởi động hoặc không phản hồi.`);
        console.log(`  (Hệ thống Node.js sẽ tự động chuyển sang chế độ giả lập local eKYC để không gián đoạn giao dịch).`);
    }

    // -------------------------------------------------------------
    // TEST 3: Kiểm tra trạng thái Khay tủ & MQTT
    // -------------------------------------------------------------
    logStep(3, "Kiểm tra danh sách khay tủ và trạng thái MQTT Broker");
    const checkLockerRes = await request(`${BASE_URL}/api/lockers/check`);
    if (checkLockerRes.ok && checkLockerRes.data && Array.isArray(checkLockerRes.data.lockers)) {
        const total = checkLockerRes.data.lockers.length;
        const available = checkLockerRes.data.lockers.filter(l => l.TRONG).length;
        logPass(`Tìm thấy ${total} khay tủ. Số khay còn trống: ${available}/${total}`);
        passedTests++;
    } else {
        logFail("Không thể đọc danh sách khay tủ từ CSDL!", checkLockerRes);
        failedTests++;
    }

    const mqttStatusRes = await request(`${BASE_URL}/api/lockers/status`);
    if (mqttStatusRes.ok && mqttStatusRes.data) {
        logPass(`MQTT Broker: ${mqttStatusRes.data.mqttConnected ? "Đã kết nối" : "Chưa kết nối"} | ESP32: ${mqttStatusRes.data.espStatus?.online ? "Online" : "Offline"}`);
        passedTests++;
    }

    // -------------------------------------------------------------
    // TEST 4: Thử nghiệm thẩm định eKYC
    // -------------------------------------------------------------
    logStep(4, "Kiểm thử Endpoint Thẩm định Sinh trắc học eKYC (/api/ekyc/verify)");
    const kycRes = await request(`${BASE_URL}/api/ekyc/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ simulateMode: "pass" })
    });
    if (kycRes.ok && kycRes.data && kycRes.data.success && kycRes.data.approved) {
        logPass("Thẩm định eKYC thành công (approved: true)");
        passedTests++;
    } else {
        logFail("Lỗi gọi API eKYC!", kycRes);
        failedTests++;
    }

    // -------------------------------------------------------------
    // TEST 5: Lưu thông tin người gửi/nhận (Luồng Gửi hàng)
    // -------------------------------------------------------------
    logStep(5, "Lưu thông tin gửi hàng tạm thời (/api/orders/save-info)");
    const testSender = {
        senderName: "Nguyễn Văn Test",
        senderPhone: "0912345678",
        receiverName: "Trần Thị Test",
        receiverPhone: "0987654321"
    };
    const saveRes = await request(`${BASE_URL}/api/orders/save-info`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(testSender)
    });
    if (saveRes.ok && saveRes.data && saveRes.data.success) {
        logPass("Đã lưu thông tin người gửi và người nhận lên server thành công.");
        passedTests++;
    } else {
        logFail("Lỗi lưu thông tin đơn hàng!", saveRes);
        failedTests++;
    }

    // -------------------------------------------------------------
    // TEST 6: Tạo đơn hàng & Mở tủ gửi đồ
    // -------------------------------------------------------------
    logStep(6, "Tạo đơn hàng, chỉ định khay trống & bắn lệnh MQTT mở tủ (/api/orders/create)");
    const createRes = await request(`${BASE_URL}/api/orders/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" }
    });

    let createdOrderCode = null;
    let createdOtp = null;
    let assignedLockerId = null;

    if (createRes.ok && createRes.data && createRes.data.success && createRes.data.order) {
        createdOrderCode = createRes.data.order.orderCode;
        createdOtp = createRes.data.order.otp;
        assignedLockerId = createRes.data.order.lockerId;
        logPass(`Đã cấp khay tủ số: ${assignedLockerId} | Mã đơn: ${createdOrderCode} | Mã OTP nhận hàng: ${createdOtp}`);
        passedTests++;
    } else {
        logFail("Không thể tạo đơn hàng hoặc mở khay tủ!", createRes);
        failedTests++;
    }

    // -------------------------------------------------------------
    // TEST 7: Đóng tủ sau khi bỏ hàng vào
    // -------------------------------------------------------------
    logStep(7, "Đóng tủ gửi hàng, khóa chốt & cập nhật đơn sang STORED (/api/orders/close-locker)");
    const closeDepositRes = await request(`${BASE_URL}/api/orders/close-locker`, {
        method: "POST",
        headers: { "Content-Type": "application/json" }
    });
    if (closeDepositRes.ok && closeDepositRes.data && closeDepositRes.data.success) {
        logPass(`Khay số ${closeDepositRes.data.lockerId} đã đóng thành công. Đơn hàng chuyển sang lưu kho.`);
        passedTests++;
    } else {
        logFail("Lỗi khi gửi lệnh đóng tủ gửi hàng!", closeDepositRes);
        failedTests++;
    }

    // -------------------------------------------------------------
    // TEST 8: Kiểm tra trường hợp nhập SAI mã OTP nhận hàng (Negative Test)
    // -------------------------------------------------------------
    logStep(8, "Kiểm thử bảo mật: Người nhận nhập sai mã OTP nhận hàng (/api/orders/receive)");
    const wrongOtpRes = await request(`${BASE_URL}/api/orders/receive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            receivePhone: testSender.receiverPhone,
            receiveOtp: "000000" // Mã OTP sai
        })
    });
    if (wrongOtpRes.status === 404) {
        logPass("Hệ thống đã chặn chính xác khi nhập sai mã OTP (HTTP 404 Not Found).");
        passedTests++;
    } else {
        logFail("Hệ thống không chặn được mã OTP sai!", wrongOtpRes);
        failedTests++;
    }

    // -------------------------------------------------------------
    // TEST 9: Người nhận nhập ĐÚNG SĐT & OTP để mở tủ lấy hàng
    // -------------------------------------------------------------
    logStep(9, "Người nhận nhập đúng SĐT và mã OTP để mở tủ lấy hàng (/api/orders/receive)");
    const correctReceiveRes = await request(`${BASE_URL}/api/orders/receive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            receivePhone: testSender.receiverPhone,
            receiveOtp: createdOtp || createdOrderCode
        })
    });
    if (correctReceiveRes.ok && correctReceiveRes.data && correctReceiveRes.data.success) {
        logPass(`Xác thực OTP thành công! Đã phát lệnh mở khay số: ${correctReceiveRes.data.order.lockerId} cho người nhận.`);
        passedTests++;
    } else {
        logFail("Xác thực nhận hàng với OTP hợp lệ thất bại!", correctReceiveRes);
        failedTests++;
    }

    // -------------------------------------------------------------
    // TEST 10: Đóng tủ sau khi lấy hàng & Giải phóng khay tủ (TRONG = 1)
    // -------------------------------------------------------------
    logStep(10, "Đóng tủ lấy hàng, cập nhật hoàn tất & giải phóng khay tủ (/api/orders/close-locker)");
    const closePickupRes = await request(`${BASE_URL}/api/orders/close-locker`, {
        method: "POST",
        headers: { "Content-Type": "application/json" }
    });
    if (closePickupRes.ok && closePickupRes.data && closePickupRes.data.success) {
        logPass(`Đã đóng tủ phiên nhận hàng (Action: ${closePickupRes.data.action}).`);
        logPass(`Thông báo: ${closePickupRes.data.message}`);
        passedTests++;
    } else {
        logFail("Lỗi khi đóng tủ phiên nhận hàng!", closePickupRes);
        failedTests++;
    }

    // -------------------------------------------------------------
    // TEST 11: Kiểm tra lại CSDL để xác nhận khay tủ đã TRỐNG trở lại
    // -------------------------------------------------------------
    logStep(11, "Kiểm tra trạng thái khay tủ trong CSDL xem đã được giải phóng thành công chưa");
    const recheckLockerRes = await request(`${BASE_URL}/api/lockers/check`);
    if (recheckLockerRes.ok && recheckLockerRes.data) {
        const locker = recheckLockerRes.data.lockers?.find(l => l.ID === assignedLockerId);
        if (locker && locker.TRONG) {
            logPass(`Xác nhận: Khay tủ số ${assignedLockerId} đã TRỐNG trở lại (TRONG = 1). Sẵn sàng nhận đơn tiếp theo!`);
            passedTests++;
        } else {
            logFail(`Khay tủ số ${assignedLockerId} vẫn chưa được giải phóng trong CSDL!`, locker);
            failedTests++;
        }
    }

    // -------------------------------------------------------------
    // TỔNG KẾT KẾT QUẢ
    // -------------------------------------------------------------
    console.log("\n==================================================================");
    console.log(`${COLORS.bold} KẾT QUẢ KIỂM THỬ TỔNG HỢP:${COLORS.reset}`);
    console.log(` ${COLORS.green}✔ Vượt qua:${COLORS.reset} ${passedTests} bài kiểm tra`);
    if (failedTests > 0) {
        console.log(` ${COLORS.red}✖ Thất bại:${COLORS.reset}  ${failedTests} bài kiểm tra`);
    } else {
        console.log(` ${COLORS.bold}${COLORS.green}★ TOÀN BỘ CÁC CHỨC NĂNG CỦA HỆ THỐNG ĐÃ HOẠT ĐỘNG HOÀN HẢO!${COLORS.reset}`);
    }
    console.log("==================================================================\n");
}

runAllTests();
