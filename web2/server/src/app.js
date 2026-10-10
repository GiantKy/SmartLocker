const express = require("express");
const path = require("path");
const fs = require("fs");

const { clientPath, clientAssetsPath } = require("./config/paths");

const app = express();

// ========================================
// Basic Middleware
// ========================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Log request đơn giản
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// ========================================
// Static Files
// ========================================
app.use("/assets", express.static(clientAssetsPath));

// ========================================
// Health Check
// ========================================
app.get("/health", (req, res) => {
    res.status(200).json({
        status: "ok",
        service: "web2-server",
        timestamp: new Date().toISOString()
    });
});

// ========================================
// API Routes phục vụ Trang Chủ (index)
// ========================================
/**
 * GET /api/lockers/check
 * Kiểm tra xem có khay tủ nào trống và trả về trạng thái tủ
 */
app.get("/api/lockers/check", async (req, res) => {
    try {
        // Mặc định trả về còn khay trống cho môi trường web2
        return res.json({
            trong: true,
            availableLockerId: 1,
            lockers: [
                { ID: 1, TRONG: 1 },
                { ID: 2, TRONG: 1 },
                { ID: 3, TRONG: 0 }
            ],
            message: "Hệ thống tủ thông minh web2 sẵn sàng"
        });
    } catch (error) {
        console.error("Lỗi API kiểm tra tủ:", error);
        return res.status(500).json({
            trong: false,
            message: "Lỗi hệ thống khi kiểm tra trạng thái tủ"
        });
    }
});

// Hủy giao dịch: đưa về trang chủ
app.all("/api/transaction/cancel", (req, res) => {
    res.redirect(303, "/");
});

// ========================================
// Page Routing
// ========================================
app.get("/", (req, res) => {
    res.sendFile(path.join(clientPath, "index.html"));
});

app.get("/index", (req, res) => {
    res.sendFile(path.join(clientPath, "index.html"));
});

app.get("/send", (req, res) => {
    const sendFilePath = path.join(clientPath, "send.html");
    if (fs.existsSync(sendFilePath)) {
        return res.sendFile(sendFilePath);
    }
    // Nếu chưa tạo send.html ở web2, tạm thời điều hướng về index
    return res.sendFile(path.join(clientPath, "index.html"));
});

app.get("/receive", (req, res) => {
    const receiveFilePath = path.join(clientPath, "receive.html");
    if (fs.existsSync(receiveFilePath)) {
        return res.sendFile(receiveFilePath);
    }
    // Nếu chưa tạo receive.html ở web2, tạm thời điều hướng về index
    return res.sendFile(path.join(clientPath, "index.html"));
});

app.get("/locker", (req, res) => {
    const lockerFilePath = path.join(clientPath, "locker.html");
    if (fs.existsSync(lockerFilePath)) {
        return res.sendFile(lockerFilePath);
    }
    return res.sendFile(path.join(clientPath, "index.html"));
});

// Xử lý 404 cho các route không xác định
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: "Endpoint hoặc tài nguyên không tìm thấy"
    });
});

module.exports = app;
