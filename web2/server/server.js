const app = require("./src/app");
const { PORT } = require("./src/config/env");

const server = app.listen(PORT, () => {
    console.log("=================================");
    console.log(" Smart Locker Web2 Server");
    console.log("=================================");
    console.log(`HTTP Server:  http://localhost:${PORT}`);
    console.log(`Health:       http://localhost:${PORT}/health`);
    console.log(`Client Index: http://localhost:${PORT}/`);
    console.log("=================================");
});

// Xử lý dừng server gọn gàng
function gracefulShutdown() {
    console.log("\nStopping web2 server...");
    server.close(() => {
        console.log("Web2 server stopped.");
        process.exit(0);
    });
}

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);
