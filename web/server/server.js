const app = require("./src/app");
const { PORT } = require("./src/config/env");
const { testConnection, pool } = require("./src/config/database");
const esp32StreamService = require("./src/services/esp32Stream.service");
const mqttService = require("./src/services/mqtt.service");

const server = app.listen(PORT, async () => {
    console.log("=================================");
    console.log(" Smart Locker Server");
    console.log("=================================");
    console.log(`HTTP Server:  http://localhost:${PORT}`);
    console.log(`Health:       http://localhost:${PORT}/health`);
    console.log(`MJPEG Stream: http://localhost:${PORT}/stream`);
    console.log(`ESP32 WS In:  ws://localhost:${PORT}/api/stream/ws`);
    console.log("=================================");

    await testConnection();
    mqttService.connect();
});

// WebSocket Binary Stream Handshake (RFC 6455) từ ESP32-CAM
server.on("upgrade", (req, socket, head) => {
    esp32StreamService.handleWebSocketUpgrade(req, socket, head);
});

// Xử lý khi server bị dừng
async function gracefulShutdown() {
    console.log("\nStopping server...");
    try {
        mqttService.disconnect();
    } catch (e) {}
    try {
        await pool.end();
    } catch (e) {}

    server.close(() => {
        console.log("Server stopped.");
        process.exit(0);
    });
}

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);