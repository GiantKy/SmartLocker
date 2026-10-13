/**
 * ==============================================================================
 * BỘ GIẢ LẬP THIẾT BỊ PHẦN CỨNG ESP32 (VIRTUAL HARDWARE SIMULATOR)
 * ==============================================================================
 * Dùng khi:
 * - Muốn test toàn bộ hệ thống từ Web Kiosk -> Server -> MQTT mà chưa cắm mạch thật.
 * - Mô phỏng đầy đủ:
 *   1. Nhịp tim trạng thái ONLINE của ESP32 (làm sáng đèn xanh "ESP32: Online" trên Web)
 *   2. Nhận lệnh MỞ TỦ (OPEN) -> Giả lập xoay motor JGY370 -> Mở chốt servo
 *   3. Nhận lệnh ĐÓNG TỦ (CLOSE) -> Giả lập đóng chốt servo
 *   4. Phản hồi trạng thái qua các Topic MQTT chuẩn: STATE, ACK, STATUS
 * ==============================================================================
 */

const mqtt = require("mqtt");

const MQTT_BROKER = process.env.MQTT_BROKER_URL || "mqtt://broker.emqx.io:1883";
const TOPIC_CMD = "SMART_LOCKER/LOCKER/CMD";
const TOPIC_STATE = "SMART_LOCKER/LOCKER/STATE";
const TOPIC_STATUS = "SMART_LOCKER/ESP32/STATUS";
const TOPIC_ACK = "SMART_LOCKER/LOCKER/ACK";

console.log("==========================================================");
console.log(" 🤖 KHỞI ĐỘNG BỘ GIẢ LẬP PHẦN CỨNG ESP32 CONTROL (SIMULATOR)");
console.log(` Đang kết nối tới Broker: ${MQTT_BROKER}...`);
console.log("==========================================================");

const client = mqtt.connect(MQTT_BROKER, {
    clientId: `virtual_esp32_${Math.random().toString(16).substring(2, 8)}`,
    clean: true,
    reconnectPeriod: 3000
});

let currentTray = 1;
let isDoorOpen = false;

client.on("connect", () => {
    console.log("[ESP32 SIM] ✔ Đã kết nối thành công tới MQTT Broker!");

    // Đăng ký nhận lệnh từ Node.js Server
    client.subscribe(TOPIC_CMD, (err) => {
        if (!err) {
            console.log(`[ESP32 SIM] Đang lắng nghe lệnh điều khiển tại topic: ${TOPIC_CMD}`);
        }
    });

    // Phát bản tin Online đầu tiên
    sendHeartbeat();

    // Duy trì nhịp tim định kỳ mỗi 5 giây
    setInterval(sendHeartbeat, 5000);
});

function sendHeartbeat() {
    const payload = {
        status: "ONLINE",
        currentTray: currentTray,
        door: isDoorOpen ? "OPEN" : "CLOSED",
        uptimeSec: Math.floor(process.uptime()),
        device: "ESP32_VIRTUAL_SIMULATOR"
    };
    client.publish(TOPIC_STATUS, JSON.stringify(payload));
}

client.on("message", (topic, message) => {
    const raw = message.toString();
    console.log(`\n[ESP32 SIM] 📩 Nhận được bản tin từ [${topic}]: ${raw}`);

    let cmd = {};
    try {
        cmd = JSON.parse(raw);
    } catch (e) {
        return;
    }

    const action = String(cmd.action || "").toUpperCase();
    const targetLocker = parseInt(cmd.lockerId, 10) || currentTray;

    // Gửi ACK xác nhận đã nhận lệnh
    const ackPayload = {
        ack: true,
        action: action,
        lockerId: targetLocker,
        timestamp: Date.now()
    };
    client.publish(TOPIC_ACK, JSON.stringify(ackPayload));

    if (action === "OPEN") {
        console.log(`[ESP32 SIM] ⚙️  Bắt đầu xoay động cơ JGY370 từ khay ${currentTray} tới khay ${targetLocker}...`);
        
        setTimeout(() => {
            currentTray = targetLocker;
            isDoorOpen = true;
            console.log(`[ESP32 SIM] 🔓 Đã đến khay ${currentTray}. Mở chốt servo cửa (Góc 90 độ)!`);

            const statePayload = {
                action: "OPEN",
                lockerId: currentTray,
                status: "OPENED",
                door: "OPEN",
                timestamp: Date.now()
            };
            client.publish(TOPIC_STATE, JSON.stringify(statePayload));
            sendHeartbeat();
        }, 1200); // Giả lập độ trễ cơ cấu xoay 1.2s

    } else if (action === "CLOSE") {
        console.log(`[ESP32 SIM] 🔒 Đang đóng chốt khóa servo khay ${targetLocker} (Góc 0 độ)...`);
        
        setTimeout(() => {
            isDoorOpen = false;
            console.log(`[ESP32 SIM] ✔ Khay ${targetLocker} đã đóng và khóa chốt an toàn!`);

            const statePayload = {
                action: "CLOSE",
                lockerId: targetLocker,
                status: "CLOSED",
                door: "CLOSED",
                timestamp: Date.now()
            };
            client.publish(TOPIC_STATE, JSON.stringify(statePayload));
            sendHeartbeat();
        }, 800);
    }
});

client.on("error", (err) => {
    console.error("[ESP32 SIM] ✖ Lỗi MQTT:", err.message);
});
