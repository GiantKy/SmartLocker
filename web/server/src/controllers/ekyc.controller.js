const fs = require("fs");
const path = require("path");
const { uploadsPath } = require("../config/paths");
const ekycService = require("../services/ekyc.service");

const EKYC_VIDEOS_DIR = path.join(uploadsPath, "ekyc/videos");

/**
 * Xử lý xác thực khuôn mặt
 * POST /api/ekyc/verify
 */
async function verifyFace(req, res, next) {
    try {
        const { image, simulateMode } = req.body;

        const result = await ekycService.verifyFace({
            imageBase64: image,
            simulateMode
        });

        return res.status(200).json(result);
    } catch (error) {
        next(error);
    }
}

/**
 * Lưu trữ video quay lại toàn bộ phiên eKYC từ đầu tới cuối làm bằng chứng xác thực
 * POST /api/ekyc/session-video
 */
async function saveSessionVideo(req, res, next) {
    try {
        if (!fs.existsSync(EKYC_VIDEOS_DIR)) {
            fs.mkdirSync(EKYC_VIDEOS_DIR, { recursive: true });
        }

        const rawSessionId = req.query.sessionId || req.headers["x-session-id"] || `session_${Date.now()}`;
        const cleanSessionId = String(rawSessionId).replace(/[^a-zA-Z0-9_-]/g, "_");
        const status = req.query.status || "COMPLETED";
        const duration = req.query.duration || 0;
        const timestamp = Date.now();
        const rawContentType = req.headers["content-type"] || "video/webm";
        const ext = rawContentType.includes("mp4") ? "mp4" : "webm";
        const filename = `ekyc_${cleanSessionId}_${timestamp}.${ext}`;
        const filePath = path.join(EKYC_VIDEOS_DIR, filename);

        const writeStream = fs.createWriteStream(filePath);
        req.pipe(writeStream);

        writeStream.on("finish", () => {
            const stats = fs.statSync(filePath);
            console.log(`[eKYC VIDEO] Đã lưu video bằng chứng phiên ${cleanSessionId}: ${filename} (${stats.size} bytes, ${rawContentType})`);

            if (stats.size === 0) {
                console.warn(`[eKYC VIDEO] Cảnh báo: File video ${filename} rỗng (0 bytes)!`);
            }

            // Lưu file JSON metadata đi kèm
            const metaFile = path.join(EKYC_VIDEOS_DIR, `ekyc_${cleanSessionId}_${timestamp}.json`);
            try {
                fs.writeFileSync(metaFile, JSON.stringify({
                    sessionId: cleanSessionId,
                    status,
                    durationSeconds: Number(duration),
                    filename,
                    sizeBytes: stats.size,
                    contentType: rawContentType,
                    url: `/uploads/ekyc/videos/${filename}`,
                    createdAt: new Date().toISOString()
                }, null, 2));
            } catch (e) {}

            return res.status(200).json({
                success: true,
                message: "Video phiên eKYC đã được lưu trữ thành công",
                sessionId: cleanSessionId,
                filename,
                url: `/uploads/ekyc/videos/${filename}`,
                sizeBytes: stats.size,
                contentType: rawContentType,
                status
            });
        });

        writeStream.on("error", (err) => {
            console.error("[eKYC VIDEO] Lỗi khi ghi video:", err);
            return res.status(500).json({
                success: false,
                message: "Lỗi ghi file video phiên eKYC",
                error: err.message
            });
        });
    } catch (error) {
        next(error);
    }
}

/**
 * Lấy danh sách video các phiên eKYC đã lưu trữ
 * GET /api/ekyc/session-videos
 */
async function listSessionVideos(req, res, next) {
    try {
        if (!fs.existsSync(EKYC_VIDEOS_DIR)) {
            return res.json({ success: true, count: 0, videos: [] });
        }

        const files = fs.readdirSync(EKYC_VIDEOS_DIR)
            .filter(f => f.endsWith(".webm"))
            .sort()
            .reverse()
            .slice(0, 50);

        const videos = files.map(filename => {
            const filePath = path.join(EKYC_VIDEOS_DIR, filename);
            const stats = fs.statSync(filePath);
            const metaPath = filePath.replace(/\.webm$/, ".json");
            let meta = null;
            if (fs.existsSync(metaPath)) {
                try {
                    meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
                } catch (e) {}
            }
            return {
                filename,
                url: `/uploads/ekyc/videos/${filename}`,
                sizeBytes: stats.size,
                createdAt: stats.birthtime,
                meta
            };
        });

        return res.json({ success: true, count: videos.length, videos });
    } catch (error) {
        next(error);
    }
}

module.exports = {
    verifyFace,
    saveSessionVideo,
    listSessionVideos
};
