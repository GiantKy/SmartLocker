const express = require("express");

const requestMiddleware = require("./middleware/request.middleware");

const errorMiddleware = require("./middleware/error.middleware");

// Config
const { clientAssetsPath, uploadsPath } = require("./config/paths");

// Routes
const pageRoutes = require("./routes/page.routes");
const lockerRoutes = require("./routes/locker.routes");
const orderRoutes = require("./routes/order.routes");
const ekycRoutes = require("./routes/ekyc.routes");
const streamRoutes = require("./routes/stream.routes");

// const authRoutes = require("./routes/auth.routes");
// const paymentRoutes = require("./routes/payment.routes");


const app = express();


// ========================================
// Basic Middleware
// ========================================

app.use(express.json());

app.use(
    express.urlencoded({
        extended: true
    })
);


// ========================================
// Static Files
// ========================================

app.use("/assets", express.static(clientAssetsPath));
app.use("/uploads", express.static(uploadsPath));
app.use("/uploads", (req, res) => {
    res.status(404).json({ success: false, message: "Upload file not found" });
});


// ========================================
// Custom Middleware
// ========================================

app.use(requestMiddleware);


// ========================================
// Health Check
// ========================================

app.get("/health", async (req, res) => {
    try {
        const { testConnection } = require("./config/database");
        const dbConnected = await testConnection();
        res.status(200).json({
            status: "ok",
            timestamp: new Date().toISOString(),
            database: dbConnected ? "connected" : "disconnected"
        });
    } catch (err) {
        res.status(500).json({
            status: "error",
            message: err.message
        });
    }
});


// ========================================
// API Routes
// ========================================

app.use("/api/lockers", lockerRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/ekyc", ekycRoutes);
app.use("/", streamRoutes);
// app.use("/api/auth", authRoutes);
// app.use("/api/payment", paymentRoutes);


// ========================================
// Page Routes
// ========================================

app.use("/", pageRoutes);


// ========================================
// 404
// ========================================

app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: "Page or API endpoint not found"
    });
});


// ========================================
// Error Middleware
// ========================================

app.use(errorMiddleware);


module.exports = app;