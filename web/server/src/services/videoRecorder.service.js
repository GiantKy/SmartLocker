const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const ffmpegPath = require("ffmpeg-static");
const { uploadsPath } = require("../config/paths");

const EKYC_VIDEOS_DIR = path.join(uploadsPath, "ekyc/videos");

/**
 * Đảm bảo thư mục lưu trữ video tồn tại
 */
function ensureVideoDir() {
    if (!fs.existsSync(EKYC_VIDEOS_DIR)) {
        fs.mkdirSync(EKYC_VIDEOS_DIR, { recursive: true });
    }
}

/**
 * Biên dịch mảng các JPEG buffers thành video MP4 chuẩn (H.264 + YUV420P + Faststart)
 * Video xuất ra tương thích 100% với HTML5 <video> và tất cả trình duyệt/thiết bị
 * @param {string} sessionId
 * @param {Array<Buffer>} frames - Mảng frame JPEG từ ESP32
 * @param {boolean} isSuccess - Kết quả xác thực
 * @param {number} fps - Tốc độ khung hình (mặc định 15 fps)
 * @returns {Promise<{ url: string, filename: string, sizeBytes: number, durationSeconds: number } | null>}
 */
function compileSessionVideo(sessionId, frames, isSuccess = true, fps = 15) {
    return new Promise((resolve) => {
        if (!frames || frames.length === 0) {
            console.warn(`[VideoRecorder] Không có frame nào để xuất video cho session: ${sessionId}`);
            return resolve(null);
        }

        ensureVideoDir();

        const cleanSessionId = String(sessionId || `session_${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, "_");
        const timestamp = Date.now();
        const filename = `ekyc_${cleanSessionId}_${timestamp}.mp4`;
        const filePath = path.join(EKYC_VIDEOS_DIR, filename);

        const durationSeconds = Math.max(1, Math.round(frames.length / fps));

        const proc = spawn(ffmpegPath, [
            "-f", "image2pipe",
            "-vcodec", "mjpeg",
            "-framerate", String(fps),
            "-i", "pipe:0",
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            "-y",
            filePath
        ]);

        let stderr = "";
        proc.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
        });

        proc.on("error", (err) => {
            console.error(`[VideoRecorder] Lỗi khi spawn ffmpeg cho session ${sessionId}:`, err);
            resolve(null);
        });

        proc.on("close", (code) => {
            if (code === 0 && fs.existsSync(filePath)) {
                const stats = fs.statSync(filePath);
                console.log(`[VideoRecorder] Đã tạo video bằng chứng: ${filename} (${stats.size} bytes, ${frames.length} frames, ${durationSeconds}s)`);

                // Lưu file metadata JSON đi kèm
                const metaFile = path.join(EKYC_VIDEOS_DIR, `ekyc_${cleanSessionId}_${timestamp}.json`);
                try {
                    fs.writeFileSync(metaFile, JSON.stringify({
                        sessionId: cleanSessionId,
                        status: isSuccess ? "APPROVED" : "FAILED",
                        durationSeconds,
                        frameCount: frames.length,
                        fps,
                        filename,
                        sizeBytes: stats.size,
                        contentType: "video/mp4",
                        url: `/uploads/ekyc/videos/${filename}`,
                        createdAt: new Date().toISOString()
                    }, null, 2));
                } catch (e) {}

                resolve({
                    url: `/uploads/ekyc/videos/${filename}`,
                    filename,
                    sizeBytes: stats.size,
                    durationSeconds
                });
            } else {
                console.warn(`[VideoRecorder] FFmpeg kết thúc với mã lỗi ${code}:`, stderr);
                resolve(null);
            }
        });

        // Ghi tuần tự toàn bộ buffer ảnh JPEG vào stdin của FFmpeg
        try {
            for (const frame of frames) {
                proc.stdin.write(frame);
            }
            proc.stdin.end();
        } catch (err) {
            console.error(`[VideoRecorder] Lỗi khi ghi frame vào stdin:`, err);
            resolve(null);
        }
    });
}

module.exports = {
    compileSessionVideo,
    EKYC_VIDEOS_DIR
};
