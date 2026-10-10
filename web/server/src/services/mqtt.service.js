const mqtt = require("mqtt");
const { EventEmitter } = require("events");
const { MQTT } = require("../config/env");

class MqttService extends EventEmitter {
    constructor() {
        super();
        this.client = null;
        this.connected = false;
        this.espStatus = {
            online: false,
            lastSeen: null,
            currentTray: null,
            currentlyOpenLockerId: null, // Khay đang mở
            door: "UNKNOWN",
            lastAction: null,
            lastAck: null
        };
    }

    /**
     * Khởi tạo kết nối tới MQTT Broker
     */
    connect() {
        if (this.client) {
            return this.client;
        }

        const clientId = `smart_locker_server_${Math.random().toString(16).substring(2, 8)}`;
        const options = {
            clientId,
            clean: true,
            connectTimeout: 10000,
            reconnectPeriod: 3000
        };

        if (MQTT.user) {
            options.username = MQTT.user;
        }
        if (MQTT.password) {
            options.password = MQTT.password;
        }

        console.log(`[MQTT] Đang kết nối tới Broker: ${MQTT.brokerUrl} (ClientId: ${clientId})...`);

        this.client = mqtt.connect(MQTT.brokerUrl, options);

        this.client.on("connect", () => {
            this.connected = true;
            console.log(`[MQTT] Đã kết nối thành công tới Broker: ${MQTT.brokerUrl}`);

            // Đăng ký nhận phản hồi trạng thái & ACK từ ESP32
            const topicsToSubscribe = [
                MQTT.topicState,
                MQTT.topicAck,
                MQTT.topicStatus
            ];

            this.client.subscribe(topicsToSubscribe, (err) => {
                if (err) {
                    console.error("[MQTT] Lỗi khi đăng ký topics:", err);
                } else {
                    console.log(`[MQTT] Đã đăng ký nhận topics: ${topicsToSubscribe.join(", ")}`);
                }
            });

            this.emit("connected");
        });

        this.client.on("message", (topic, messageBuffer) => {
            const rawMessage = messageBuffer.toString();
            console.log(`[MQTT] Nhận tin nhắn [${topic}]: ${rawMessage}`);

            let data = null;
            try {
                data = JSON.parse(rawMessage);
            } catch (e) {
                data = { raw: rawMessage };
            }

            this.espStatus.lastSeen = new Date();
            this.espStatus.online = true;

            if (topic === MQTT.topicStatus) {
                if (data.status === "ONLINE") {
                    this.espStatus.online = true;
                } else if (data.status === "OFFLINE") {
                    this.espStatus.online = false;
                }
                if (data.currentTray !== undefined) {
                    this.espStatus.currentTray = data.currentTray;
                }
                if (data.door !== undefined) {
                    this.espStatus.door = data.door;
                    if (data.door === "CLOSED") {
                        this.espStatus.currentlyOpenLockerId = null;
                    }
                }
                this.emit("esp_status", data);
            } else if (topic === MQTT.topicAck) {
                this.espStatus.lastAck = data;
                this.emit("esp_ack", data);
            } else if (topic === MQTT.topicState) {
                if (data.lockerId !== undefined) {
                    this.espStatus.currentTray = data.lockerId;
                }
                if (data.door !== undefined) {
                    this.espStatus.door = data.door;
                }
                if (data.status !== undefined) {
                    this.espStatus.lastAction = data.status;
                }

                // Cập nhật khay nào đang được mở
                if (data.status === "OPENED" || data.door === "OPEN") {
                    this.espStatus.currentlyOpenLockerId = data.lockerId || this.espStatus.currentTray;
                } else if (data.status === "CLOSED" || data.door === "CLOSED") {
                    this.espStatus.currentlyOpenLockerId = null;
                }

                this.emit("esp_state", data);
            }
        });

        this.client.on("error", (err) => {
            console.error("[MQTT] Lỗi kết nối MQTT:", err.message);
            this.emit("error", err);
        });

        this.client.on("offline", () => {
            this.connected = false;
            console.warn("[MQTT] Broker đang offline hoặc mất kết nối!");
            this.emit("offline");
        });

        this.client.on("reconnect", () => {
            console.log("[MQTT] Đang thử kết nối lại...");
        });

        return this.client;
    }

    /**
     * Gửi lệnh điều khiển khay tủ tới ESP32
     * @param {string} action "OPEN" hoặc "CLOSE"
     * @param {number} lockerId Số khay tủ (1 - 6)
     * @param {Object} [extra={}] Thông tin bổ sung
     * @returns {Promise<boolean>}
     */
    publishCommand(action, lockerId, extra = {}) {
        return new Promise((resolve, reject) => {
            if (!this.client || !this.connected) {
                console.warn("[MQTT] Chưa kết nối tới broker. Thử publish với queue hoặc kết nối lại...");
            }

            const payloadObj = {
                action: action.toUpperCase(),
                lockerId: parseInt(lockerId, 10),
                timestamp: Date.now(),
                ...extra
            };

            const payloadStr = JSON.stringify(payloadObj);
            const topic = MQTT.topicCmd;

            console.log(`[MQTT] >>> Gửi lệnh tới ESP32 [${topic}]: ${payloadStr}`);

            if (!this.client) {
                return reject(new Error("MQTT Client chưa được khởi tạo"));
            }

            this.client.publish(topic, payloadStr, { qos: 1 }, (err) => {
                if (err) {
                    console.error(`[MQTT] Lỗi khi gửi lệnh tới ${topic}:`, err);
                    return reject(err);
                }
                console.log(`[MQTT] Đã gửi lệnh thành công tới topic: ${topic}`);
                resolve(true);
            });
        });
    }

    /**
     * Gửi lệnh MỞ khay tủ cho ESP32
     * @param {number} lockerId Số khay tủ (1 - 6)
     * @param {Object} [extra]
     * @returns {Promise<boolean>}
     */
    openLocker(lockerId, extra = {}) {
        this.espStatus.currentlyOpenLockerId = parseInt(lockerId, 10);
        this.espStatus.door = "OPEN";
        return this.publishCommand("OPEN", lockerId, extra);
    }

    /**
     * Gửi lệnh ĐÓNG khay tủ cho ESP32
     * @param {number} lockerId Số khay tủ (1 - 6)
     * @param {Object} [extra]
     * @returns {Promise<boolean>}
     */
    closeLocker(lockerId, extra = {}) {
        this.espStatus.currentlyOpenLockerId = null;
        this.espStatus.door = "CLOSED";
        return this.publishCommand("CLOSE", lockerId, extra);
    }

    /**
     * Lấy ID khay tủ đang được mở ghi nhận từ server & ESP32
     * @returns {number|null}
     */
    getCurrentlyOpenLockerId() {
        return this.espStatus.currentlyOpenLockerId;
    }

    /**
     * Kiểm tra trạng thái kết nối MQTT
     * @returns {boolean}
     */
    isConnected() {
        return this.connected;
    }

    /**
     * Lấy thông tin trạng thái ESP32 gần nhất
     * @returns {Object}
     */
    getEspStatus() {
        return this.espStatus;
    }

    /**
     * Ngắt kết nối MQTT khi tắt server
     */
    disconnect() {
        if (this.client) {
            console.log("[MQTT] Đang ngắt kết nối MQTT Client...");
            this.client.end(true);
            this.client = null;
            this.connected = false;
        }
    }
}

// Singleton instance
const mqttService = new MqttService();

module.exports = mqttService;
