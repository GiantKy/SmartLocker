const path = require("path");
const dotenv = require("dotenv");

// Nạp file .env từ thư mục server/
dotenv.config({ path: path.join(__dirname, "../../.env") });

module.exports = {
    PORT: process.env.PORT || 3000,
    DB: {
        host: process.env.DB_HOST || "127.0.0.1",
        port: parseInt(process.env.DB_PORT, 10) || 3306,
        user: process.env.DB_USER || "root",
        password: process.env.DB_PASSWORD || "",
        database: process.env.DB_NAME || "smart_locker_db",
        connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT, 10) || 10,
        waitForConnections: true,
        queueLimit: 0,
        charset: "utf8mb4"
    },
    MQTT: {
        brokerUrl: process.env.MQTT_BROKER_URL || "mqtt://broker.emqx.io:1883",
        user: process.env.MQTT_USER || "",
        password: process.env.MQTT_PASSWORD || "",
        topicCmd: process.env.MQTT_TOPIC_CMD || "SMART_LOCKER/LOCKER/CMD",
        topicState: process.env.MQTT_TOPIC_STATE || "SMART_LOCKER/LOCKER/STATE",
        topicAck: process.env.MQTT_TOPIC_ACK || "SMART_LOCKER/LOCKER/ACK",
        topicStatus: process.env.MQTT_TOPIC_STATUS || "SMART_LOCKER/ESP32/STATUS"
    }
};
