const http = require("http");
const crypto = require("crypto");

/**
 * ============================================================================
 * ESP32 STREAM RELAY & ON-DEMAND CAMERA POWER CONTROLLER SERVICE
 * ============================================================================
 * Cơ chế On-Demand chống nóng camera (Anti-Overheating):
 * 1. Mặc định camera ở chế độ TẮT (Standby).
 * 2. Chỉ BẬT camera khi bước vào luồng eKYC (/kyc).
 * 3. Khi hoàn tất xác thực (hoặc Hủy, hoặc rời trang), lập tức TẮT camera.
 * 4. Tự động ngắt (Auto-Standby) sau 20s nếu không có người xem để bảo vệ chip và cảm biến.
 * 5. Bỏ hoàn toàn phần chỉnh LED ESP32-CAM.
 * ============================================================================
 */

let latestFrame = null;
let latestFrameTime = 0;
let esp32DeviceIp = "";
let isCameraActive = false;           // Trạng thái bật/tắt camera
let lastActiveTimestamp = 0;          // Thời điểm gần nhất có hoạt động KYC
let activeEsp32Socket = null;         // Kết nối WebSocket 2 chiều trực tiếp tới ESP32-CAM
const streamClients = new Set();
const STREAM_TIMEOUT_MS = 5000;
const AUTO_STANDBY_TIMEOUT_MS = 20000; // 20 giây không có ai xem -> tự động tắt cam

/**
 * Gửi bản tin Text Frame (Opcode 0x01) chuẩn RFC 6455 từ Server xuống ESP32
 */
function sendWebSocketTextMessage(socket, text) {
    if (!socket || socket.destroyed || !socket.writable) return false;
    try {
        const payload = Buffer.from(text, "utf8");
        const len = payload.length;
        let header;
        if (len <= 125) {
            header = Buffer.from([0x81, len]);
        } else if (len <= 65535) {
            header = Buffer.from([0x81, 126, (len >> 8) & 0xff, len & 0xff]);
        } else {
            return false;
        }
        socket.write(Buffer.concat([header, payload]));
        return true;
    } catch (e) {
        return false;
    }
}

// Watchdog kiểm tra kết nối & tự động tắt camera nếu không còn ai xem
setInterval(() => {
    const now = Date.now();

    // 1. Kiểm tra mất frame quá 5 giây -> reset buffer
    if (latestFrame && latestFrameTime > 0 && (now - latestFrameTime > STREAM_TIMEOUT_MS)) {
        latestFrame = null;
        for (const client of streamClients) {
            try {
                client.end();
            } catch (e) {}
        }
        streamClients.clear();
    }

    // 2. Auto-Standby: Nếu camera đang BẬT nhưng 20s không có viewer nào -> Tắt camera chống nóng
    if (isCameraActive && streamClients.size === 0 && (now - lastActiveTimestamp > AUTO_STANDBY_TIMEOUT_MS)) {
        console.log("[ESP32 POWER WATCHDOG] Không có người xem trong 20s. Tự động TẮT camera ESP32 để chống nóng chip.");
        setCameraPower(false);
    }
}, 1000);

/**
 * Lệnh BẬT / TẮT camera gửi tới ESP32-CAM
 * @param {boolean} enable true = Bật cam cho KYC, false = Tắt cam chống nóng
 */
function setCameraPower(enable) {
    isCameraActive = Boolean(enable);
    if (isCameraActive) {
        lastActiveTimestamp = Date.now();
    } else {
        // Xóa đệm frame cũ khi tắt cam
        latestFrame = null;
        latestFrameTime = 0;
        for (const client of streamClients) {
            try {
                client.end();
            } catch (e) {}
        }
        streamClients.clear();
    }

    const stateStr = isCameraActive ? "BẬT" : "TẮT";
    const wsCmd = isCameraActive ? "STREAM:ON" : "STREAM:OFF";
    console.log(`[ESP32 POWER] Đã yêu cầu ${stateStr} camera ESP32 (Target IP: ${esp32DeviceIp || "Chưa có IP"}).`);

    // 1. Gửi lệnh tức thì qua WebSocket Text Frame (Độ trễ 0ms, không phụ thuộc routing inbound)
    if (activeEsp32Socket && !activeEsp32Socket.destroyed && activeEsp32Socket.writable) {
        sendWebSocketTextMessage(activeEsp32Socket, wsCmd);
        console.log(`[ESP32 POWER] Đã gửi lệnh điều khiển tới ESP32 qua WebSocket: ${wsCmd}`);
    }

    if (!esp32DeviceIp) {
        return {
            success: true,
            is_camera_active: isCameraActive,
            esp32_ip: "",
            socket_connected: Boolean(activeEsp32Socket && !activeEsp32Socket.destroyed && activeEsp32Socket.writable),
            note: activeEsp32Socket ? "Đã gửi lệnh WebSocket, đang chờ frame" : "Chờ ESP32 kết nối"
        };
    }

    // 2. Gửi dự phòng qua HTTP GET tới ESP32: /set-stream?enable=1 hoặc enable=0
    const param = isCameraActive ? "1" : "0";
    const targetUrl = `http://${esp32DeviceIp}/set-stream?enable=${param}`;

    const req = http.get(targetUrl, { timeout: 2500 }, (res) => {
        let body = "";
        res.on("data", chunk => body += chunk);
        res.on("end", () => {
            console.log(`[ESP32 POWER] Phản hồi HTTP từ ESP32 (${stateStr}): ${body || res.statusCode}`);
        });
    });

    req.on("error", (err) => {
        // Fallback sang endpoint /set-camera?stream=1 / 0
        const fallbackUrl = `http://${esp32DeviceIp}/set-camera?stream=${param}`;
        http.get(fallbackUrl, { timeout: 2000 }, () => {}).on("error", () => {});
    });

    return {
        success: true,
        is_camera_active: isCameraActive,
        esp32_ip: esp32DeviceIp,
        socket_connected: Boolean(activeEsp32Socket && !activeEsp32Socket.destroyed && activeEsp32Socket.writable)
    };
}

/**
 * Endpoint API điều khiển Bật/Tắt camera: GET/POST /api/camera/power
 */
function handleCameraPower(req, res) {
    let enable = true;

    if (req.method === "POST" && req.body && req.body.enable !== undefined) {
        enable = Boolean(req.body.enable);
    } else if (req.query && req.query.enable !== undefined) {
        enable = (req.query.enable === "1" || req.query.enable === "true" || req.query.enable === "on");
    }

    const result = setCameraPower(enable);

    res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
    });
    res.end(JSON.stringify(result));
}

/**
 * Broadcast frame mới nhất tới các client đang xem luồng MJPEG (/stream)
 * Drop-frame nếu client socket chưa kịp gửi xong gói trước để chống trễ (anti buffer bloat)
 */
function broadcastFrame(frameBuffer) {
    if (streamClients.size === 0) return;
    const boundary = "--mjpeg_frame\r\n";
    const header = `Content-Type: image/jpeg\r\nContent-Length: ${frameBuffer.length}\r\n\r\n`;
    const footer = "\r\n";

    for (const client of streamClients) {
        if (client.writableLength > 0 || (client.socket && client.socket.bufferSize > 0)) {
            continue;
        }
        try {
            client.write(boundary);
            client.write(header);
            client.write(frameBuffer);
            client.write(footer);
        } catch (err) {
            streamClients.delete(client);
        }
    }
}

/**
 * Xử lý nâng cấp kết nối WebSocket (RFC 6455) từ ESP32-CAM
 */
function handleWebSocketUpgrade(req, socket, head) {
    const parsedUrl = new URL(req.url, "http://localhost");
    const pathname = parsedUrl.pathname;

    if (pathname !== "/api/stream/ws" && pathname !== "/ws") {
        socket.destroy();
        return;
    }

    const key = req.headers["sec-websocket-key"];
    if (!key) {
        socket.destroy();
        return;
    }

    const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    const acceptKey = crypto.createHash("sha1").update(key + GUID).digest("base64");

    socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${acceptKey}\r\n\r\n`
    );

    socket.setNoDelay(true);
    socket.setKeepAlive(true, 1000);

    const rawIp = req.headers["x-esp32-ip"] || socket.remoteAddress || "";
    esp32DeviceIp = rawIp.replace(/^::ffff:/, "");
    console.log(`[ESP32 WS] ESP32-CAM đã kết nối WebSocket Stream tại ${esp32DeviceIp || "Client"}`);

    let rxBuffer = Buffer.alloc(0);

    socket.on("data", (chunk) => {
        rxBuffer = rxBuffer.length === 0 ? chunk : Buffer.concat([rxBuffer, chunk]);

        while (rxBuffer.length >= 2) {
            const byte0 = rxBuffer[0];
            const byte1 = rxBuffer[1];

            const opcode = byte0 & 0x0f;
            const masked = (byte1 & 0x80) !== 0;
            let payloadLen = byte1 & 0x7f;

            let headerLen = 2;
            if (payloadLen === 126) {
                if (rxBuffer.length < headerLen + 2) break;
                payloadLen = rxBuffer.readUInt16BE(headerLen);
                headerLen += 2;
            } else if (payloadLen === 127) {
                if (rxBuffer.length < headerLen + 8) break;
                payloadLen = Number(rxBuffer.readBigUInt64BE(headerLen));
                headerLen += 8;
            }

            let maskKey = null;
            if (masked) {
                if (rxBuffer.length < headerLen + 4) break;
                maskKey = rxBuffer.subarray(headerLen, headerLen + 4);
                headerLen += 4;
            }

            const totalFrameLen = headerLen + payloadLen;
            if (rxBuffer.length < totalFrameLen) {
                break;
            }

            const payload = rxBuffer.subarray(headerLen, totalFrameLen);
            if (masked && maskKey) {
                for (let i = 0; i < payload.length; i++) {
                    payload[i] ^= maskKey[i % 4];
                }
            }

            rxBuffer = rxBuffer.subarray(totalFrameLen);

            if (opcode === 0x02) {
                // Binary Frame: Ảnh JPEG từ ESP32
                if (payload.length > 500) {
                    latestFrame = Buffer.from(payload);
                    latestFrameTime = Date.now();
                    lastActiveTimestamp = Date.now();
                    broadcastFrame(latestFrame);
                }
            } else if (opcode === 0x09) {
                socket.write(Buffer.from([0x8a, 0x00]));
            } else if (opcode === 0x08) {
                socket.end();
                break;
            }
        }
    });

    activeEsp32Socket = socket;

    socket.on("close", () => {
        if (activeEsp32Socket === socket) activeEsp32Socket = null;
        console.log("[ESP32 WS] ESP32-CAM đã ngắt kết nối WebSocket.");
    });

    socket.on("error", (err) => {
        if (activeEsp32Socket === socket) activeEsp32Socket = null;
        console.log(`[ESP32 WS] Socket error: ${err.message}`);
    });
}

/**
 * Xử lý HTTP POST /api/stream/frame (Fallback)
 */
function handleHttpFrameIngest(req, res) {
    if (req.socket) req.socket.setNoDelay(true);
    const contentLength = parseInt(req.headers["content-length"] || "0", 10);

    const onFrameReceived = (buffer) => {
        if (buffer.length > 500) {
            latestFrame = buffer;
            latestFrameTime = Date.now();
            lastActiveTimestamp = Date.now();

            const rawIp = req.headers["x-esp32-ip"] || req.socket.remoteAddress || "";
            esp32DeviceIp = rawIp.replace(/^::ffff:/, "");

            broadcastFrame(buffer);
        }

        res.writeHead(200, {
            "Content-Type": "text/plain",
            "Content-Length": "2",
            "Connection": "keep-alive"
        });
        res.end("OK");
    };

    if (contentLength > 500 && contentLength < 500000) {
        const fixedBuf = Buffer.allocUnsafe(contentLength);
        let offset = 0;
        req.on("data", (chunk) => {
            chunk.copy(fixedBuf, offset);
            offset += chunk.length;
        });
        req.on("end", () => {
            onFrameReceived(offset === contentLength ? fixedBuf : fixedBuf.subarray(0, offset));
        });
    } else {
        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => {
            onFrameReceived(Buffer.concat(chunks));
        });
    }
}

/**
 * Xử lý GET /stream (MJPEG Broadcaster cho Web Browser)
 */
function handleMjpegStream(req, res) {
    lastActiveTimestamp = Date.now();

    res.writeHead(200, {
        "Content-Type": "multipart/x-mixed-replace; boundary=mjpeg_frame",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Connection": "close",
        "Access-Control-Allow-Origin": "*"
    });

    if (res.socket) {
        res.socket.setNoDelay(true);
        res.socket.setKeepAlive(true, 1000);
    }

    streamClients.add(res);

    if (latestFrame) {
        try {
            res.write("--mjpeg_frame\r\n");
            res.write(`Content-Type: image/jpeg\r\nContent-Length: ${latestFrame.length}\r\n\r\n`);
            res.write(latestFrame);
            res.write("\r\n");
        } catch (e) {}
    }

    req.on("close", () => {
        streamClients.delete(res);
        if (streamClients.size === 0) {
            lastActiveTimestamp = Date.now();
        }
    });
}

/**
 * Xử lý GET /api/stream/latest (Lấy 1 frame JPEG mới nhất)
 */
function handleGetLatestFrame(req, res) {
    lastActiveTimestamp = Date.now();
    const isFrameFresh = latestFrame && (Date.now() - latestFrameTime <= STREAM_TIMEOUT_MS);
    if (!isFrameFresh) {
        res.writeHead(503, {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
        });
        res.end(JSON.stringify({
            error: "ESP32_DISCONNECTED",
            message: "ESP32-CAM chưa truyền frame mới hoặc đang ở chế độ tắt"
        }));
        return;
    }

    res.writeHead(200, {
        "Content-Type": "image/jpeg",
        "Content-Length": latestFrame.length,
        "Cache-Control": "no-cache, no-store",
        "Access-Control-Allow-Origin": "*"
    });
    res.end(latestFrame);
}

/**
 * Xử lý GET /api/device/info (Trạng thái ESP32)
 */
function handleDeviceInfo(req, res) {
    const isLive = latestFrame !== null && (latestFrameTime > 0) && ((Date.now() - latestFrameTime) <= STREAM_TIMEOUT_MS);
    const isSocketConnected = Boolean(activeEsp32Socket && !activeEsp32Socket.destroyed && activeEsp32Socket.writable);
    res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
    });
    res.end(JSON.stringify({
        is_live: isLive,
        has_frame: isLive,
        socket_connected: isSocketConnected,
        is_connected: isLive || isSocketConnected,
        is_camera_active: isCameraActive,
        esp32_ip: esp32DeviceIp || (isSocketConnected ? "ESP32 (WebSocket)" : ""),
        last_frame_ago_ms: latestFrameTime > 0 ? (Date.now() - latestFrameTime) : -1,
        active_viewers: streamClients.size
    }));
}

/**
 * Xử lý POST/GET /api/device/set-ip (Cài đặt IP ESP32 thủ công)
 */
function handleSetDeviceIp(req, res) {
    const newIp = req.query.ip || (req.body && req.body.ip);
    if (newIp) {
        esp32DeviceIp = String(newIp).trim();
        console.log(`[ESP32] Đã cập nhật thủ công IP ESP32: ${esp32DeviceIp}`);
    }
    res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
    });
    res.end(JSON.stringify({ success: true, esp32_ip: esp32DeviceIp }));
}

/**
 * Xử lý GET /api/camera/control (Chỉnh thông số camera)
 */
function handleCameraControl(req, res) {
    const targetIp = esp32DeviceIp;
    if (!targetIp) {
        return res.json({
            status: "OK",
            mode: "LOCAL_ONLY",
            message: "ESP32 chưa cập nhật IP"
        });
    }

    if (req.query.hmirror !== undefined && activeEsp32Socket && !activeEsp32Socket.destroyed && activeEsp32Socket.writable) {
        sendWebSocketTextMessage(activeEsp32Socket, `HMIRROR:${req.query.hmirror}`);
    }

    const queryStr = new URLSearchParams(req.query).toString();
    const targetUrl = `http://${targetIp}/set-camera?${queryStr}`;

    const espReq = http.get(targetUrl, { timeout: 3000 }, (espRes) => {
        let data = "";
        espRes.on("data", chunk => data += chunk);
        espRes.on("end", () => {
            res.json({
                status: "SUCCESS",
                esp32_ip: targetIp,
                response: data || "OK"
            });
        });
    });

    espReq.on("error", (err) => {
        res.json({
            status: "ERROR",
            esp32_ip: targetIp,
            error: err.message
        });
    });
}

/**
 * Chuyển tiếp (Reverse Proxy) /api/v1/* sang FastAPI AI Server (:8000)
 */
function proxyToAiServer(req, res) {
    const aiServerHost = process.env.AI_SERVER_HOST || "127.0.0.1";
    const aiServerPort = parseInt(process.env.AI_SERVER_PORT || "8000", 10);

    const proxyOptions = {
        hostname: aiServerHost,
        port: aiServerPort,
        path: req.originalUrl || req.url,
        method: req.method,
        headers: {
            ...req.headers,
            host: `${aiServerHost}:${aiServerPort}`
        }
    };

    const proxyReq = http.request(proxyOptions, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
    });

    proxyReq.on("error", (err) => {
        console.error(`[AI PROXY ERROR] Không thể kết nối tới FastAPI AI Server (${aiServerHost}:${aiServerPort}): ${err.message}`);
        res.status(502).json({
            detail: `Không thể kết nối tới FastAPI AI Server tại ${aiServerHost}:${aiServerPort}. Lỗi: ${err.message}`
        });
    });

    req.pipe(proxyReq);
}

module.exports = {
    handleWebSocketUpgrade,
    handleHttpFrameIngest,
    handleMjpegStream,
    handleGetLatestFrame,
    handleDeviceInfo,
    handleSetDeviceIp,
    handleCameraPower,
    handleCameraControl,
    setCameraPower,
    proxyToAiServer,
    getLatestFrame: () => latestFrame,
    getEsp32DeviceIp: () => esp32DeviceIp,
    isCameraActive: () => isCameraActive,
    isEsp32Live: () => latestFrame !== null && (latestFrameTime > 0) && ((Date.now() - latestFrameTime) <= STREAM_TIMEOUT_MS)
};
