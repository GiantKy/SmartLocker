const http = require("http");
const crypto = require("crypto");
const { compileSessionVideo } = require("./videoRecorder.service");

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
const clientKycSessions = new Map();     // Danh sách các phiên Web Client KYC đang kết nối qua WebSocket
const STREAM_TIMEOUT_MS = 5000;
const AUTO_STANDBY_TIMEOUT_MS = 20000; // 20 giây không có ai xem -> tự động tắt cam

/**
 * Gửi bản tin Text Frame (Opcode 0x01) chuẩn RFC 6455 từ Server xuống ESP32 hoặc Web Client
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
            const lenBuf = Buffer.alloc(8);
            lenBuf.writeBigUInt64BE(BigInt(len));
            header = Buffer.concat([Buffer.from([0x81, 127]), lenBuf]);
        }
        socket.write(Buffer.concat([header, payload]));
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Gửi đối tượng JSON qua WebSocket chuẩn RFC 6455
 */
function sendWsJson(socket, obj) {
    return sendWebSocketTextMessage(socket, JSON.stringify(obj));
}

/**
 * Gửi chỉ lệnh hiển thị chuẩn (Render Directive) cho HTML Frontend:
 * Frontend chỉ đóng vai trò "Dumb View & Control", nhận render directive và vẽ lên DOM,
 * hoàn toàn không chứa bất kỳ logic tính toán hay state machine nào.
 */
function sendWsRender(socket, renderObj, extra = {}) {
    return sendWsJson(socket, {
        type: extra.type || "RENDER",
        ...extra,
        render: {
            prompt: renderObj.prompt !== undefined ? renderObj.prompt : "",
            ovalState: renderObj.ovalState !== undefined ? renderObj.ovalState : "",
            stageTurn: Boolean(renderObj.stageTurn),
            countdown: renderObj.countdown !== undefined ? renderObj.countdown : 0,
            arrow: renderObj.arrow !== undefined ? renderObj.arrow : null,
            progress: renderObj.progress !== undefined ? renderObj.progress : null,
            sound: renderObj.sound !== undefined ? renderObj.sound : null,
            result: renderObj.result || { show: false },
            recordAction: renderObj.recordAction !== undefined ? renderObj.recordAction : null
        }
    });
}

function onEsp32Disconnected() {
    latestFrame = null;
    latestFrameTime = 0;
    for (const [clientSocket, session] of clientKycSessions.entries()) {
        if (session.countdownTimer) {
            clearInterval(session.countdownTimer);
            session.countdownTimer = null;
        }
        session.countdownSec = 3;
        session.consecutiveGoodFrames = 0;
        session.isRecording = false;
        session.recordingFrames = [];
        session.isProcessingAi = false;
        session.state = "ALIGN_FACE";

        sendWsRender(session.socket, {
            prompt: "Mất kết nối camera ESP32. Đang chờ kết nối lại...",
            ovalState: "state-warning",
            countdown: 0,
            stageTurn: false,
            arrow: null,
            progress: null,
            recordAction: "CANCEL"
        }, {
            type: "CAMERA_DISCONNECTED",
            esp32_connected: false
        });
    }
}

// Watchdog kiểm tra kết nối & tự động tắt camera nếu không còn ai xem
setInterval(() => {
    const now = Date.now();

    // 1. Kiểm tra mất frame quá 2.5 giây khi camera đang BẬT và có phiên KYC
    if (isCameraActive && clientKycSessions.size > 0 && latestFrameTime > 0 && (now - latestFrameTime > 2500)) {
        latestFrame = null;
        for (const [clientSocket, session] of clientKycSessions.entries()) {
            if (session.state !== "ALIGN_FACE" || session.countdownTimer) {
                if (session.countdownTimer) {
                    clearInterval(session.countdownTimer);
                    session.countdownTimer = null;
                }
                session.countdownSec = 3;
                session.consecutiveGoodFrames = 0;
                session.isRecording = false;
                session.recordingFrames = [];
                session.isProcessingAi = false;
                session.state = "ALIGN_FACE";

                sendWsRender(session.socket, {
                    prompt: "Mất tín hiệu camera. Đang đợi kết nối lại...",
                    ovalState: "state-warning",
                    countdown: 0,
                    stageTurn: false,
                    arrow: null,
                    progress: null,
                    recordAction: "CANCEL"
                }, {
                    type: "CAMERA_DISCONNECTED",
                    esp32_connected: false
                });
            }
        }
    }

    // 2. Auto-Standby: Nếu camera đang BẬT nhưng 20s không có viewer nào và không có client KYC -> Tắt camera chống nóng
    if (isCameraActive && streamClients.size === 0 && clientKycSessions.size === 0 && (now - lastActiveTimestamp > AUTO_STANDBY_TIMEOUT_MS)) {
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
 * Xử lý nâng cấp kết nối WebSocket (RFC 6455)
 * Hỗ trợ 2 luồng:
 * 1. ESP32-CAM (/api/stream/ws hoặc /ws): Nhận JPEG binary frame
 * 2. Web Client KYC (/api/kyc/ws hoặc /ws/kyc): Nhận lệnh điều khiển, bật cam, gửi kết quả AI
 */
function handleWebSocketUpgrade(req, socket, head) {
    const parsedUrl = new URL(req.url, "http://localhost");
    const pathname = parsedUrl.pathname;

    if (pathname === "/api/stream/ws" || pathname === "/ws") {
        handleEsp32WebSocket(req, socket, head);
    } else if (pathname === "/api/kyc/ws" || pathname === "/ws/kyc") {
        handleClientKycWebSocket(req, socket, head);
    } else {
        socket.destroy();
    }
}

/**
 * 1. Xử lý kết nối WebSocket từ ESP32-CAM (Nhận binary frame ảnh)
 */
function handleEsp32WebSocket(req, socket, head) {
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
                    const wasDisconnected = (latestFrame === null);
                    latestFrame = Buffer.from(payload);
                    latestFrameTime = Date.now();
                    lastActiveTimestamp = Date.now();
                    broadcastFrame(latestFrame);

                    if (wasDisconnected) {
                        for (const [clientSocket, session] of clientKycSessions.entries()) {
                            session.state = "ALIGN_FACE";
                            session.consecutiveGoodFrames = 0;
                            sendWsRender(session.socket, {
                                prompt: "Vui lòng đưa mặt vào giữa khung oval",
                                ovalState: "",
                                countdown: 0,
                                stageTurn: false,
                                arrow: null,
                                progress: null
                            }, {
                                type: "STREAM_RELOAD",
                                esp32_connected: true
                            });
                        }
                    }

                    // Chuyển frame tới AI để phân tích cho các Web Client đang KYC
                    dispatchFrameToAiSessions(latestFrame);
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

    // Tự động gửi lệnh STREAM:ON ngay khi ESP32 cắm lại nếu có phiên KYC đang mở
    if (isCameraActive || clientKycSessions.size > 0) {
        sendWebSocketTextMessage(socket, "STREAM:ON");
        console.log("[ESP32 WS] Đã tự động gửi lệnh STREAM:ON cho ESP32 vừa kết nối lại.");
    }

    socket.on("close", () => {
        if (activeEsp32Socket === socket) {
            activeEsp32Socket = null;
            onEsp32Disconnected();
        }
        console.log("[ESP32 WS] ESP32-CAM đã ngắt kết nối WebSocket.");
    });

    socket.on("error", (err) => {
        if (activeEsp32Socket === socket) {
            activeEsp32Socket = null;
            onEsp32Disconnected();
        }
        console.log(`[ESP32 WS] Socket error: ${err.message}`);
    });
}

/**
 * 2. Xử lý kết nối WebSocket từ Web Client (/api/kyc/ws)
 * Khi client vào trang -> Server nhận kết nối -> Lập tức gửi lệnh bật cam ESP32
 */
function handleClientKycWebSocket(req, socket, head) {
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

    const sessionId = `kyc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const session = {
        id: sessionId,
        socket,
        state: "ALIGN_FACE", // ALIGN_FACE -> COUNTDOWN -> CHALLENGE_BLINK -> CHALLENGE_HEAD -> VERIFYING -> COMPLETED
        sessionId: null,
        baseFrame: null,
        consecutiveGoodFrames: 0,
        countdownSec: 3,
        countdownTimer: null,
        isProcessingAi: false,
        lastAiCallTime: 0,
        blinkCounter: 0,
        blinkState: false,
        baselineEar: 0.28,
        headAction: "turn_right",
        challengeStartTime: 0,
        isRecording: false,
        recordingFrames: [],
        lastRecordedFrameTime: 0,
        createdAt: Date.now()
    };

    clientKycSessions.set(socket, session);
    console.log(`[KYC WS] Web Client đã kết nối WebSocket (${sessionId}). Đang yêu cầu BẬT camera ESP32...`);

    // Gửi lệnh bật camera ESP32 ngay lập tức
    setCameraPower(true);

    sendWsRender(socket, {
        prompt: "Đang bật camera ESP32...",
        ovalState: "state-warning",
        stageTurn: false,
        countdown: 0,
        arrow: null,
        progress: null,
        result: { show: false }
    }, {
        type: "CAMERA_STATUS",
        is_camera_active: isCameraActive,
        esp32_connected: Boolean(activeEsp32Socket && !activeEsp32Socket.destroyed),
        esp32_ip: esp32DeviceIp || "",
        message: "Đã kết nối máy chủ, đang bật camera ESP32..."
    });

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
            if (rxBuffer.length < totalFrameLen) break;

            const payload = rxBuffer.subarray(headerLen, totalFrameLen);
            if (masked && maskKey) {
                for (let i = 0; i < payload.length; i++) {
                    payload[i] ^= maskKey[i % 4];
                }
            }

            rxBuffer = rxBuffer.subarray(totalFrameLen);

            if (opcode === 0x01) {
                // Text JSON frame từ Browser
                try {
                    const text = payload.toString("utf8");
                    const msg = JSON.parse(text);
                    handleClientWsMessage(session, msg);
                } catch (e) {}
            } else if (opcode === 0x09) {
                socket.write(Buffer.from([0x8a, 0x00])); // Pong
            } else if (opcode === 0x08) {
                socket.end();
                break;
            }
        }
    });

    const cleanup = () => {
        if (session.countdownTimer) {
            clearInterval(session.countdownTimer);
            session.countdownTimer = null;
        }
        session.isRecording = false;
        session.recordingFrames = [];
        clientKycSessions.delete(socket);
        console.log(`[KYC WS] Web Client đã ngắt kết nối (${sessionId}). Còn lại: ${clientKycSessions.size} client`);
        if (clientKycSessions.size === 0) {
            console.log("[KYC WS] Không còn client KYC nào đang xem. Tự động TẮT camera ESP32.");
            setCameraPower(false);
        }
    };

    socket.on("close", cleanup);
    socket.on("error", cleanup);
}

/**
 * Xử lý tin nhắn hành động từ Client (restart, stop...)
 */
function handleClientWsMessage(session, msg) {
    if (!msg || typeof msg !== "object") return;

    if (msg.action === "restart") {
        if (session.countdownTimer) {
            clearInterval(session.countdownTimer);
            session.countdownTimer = null;
        }
        session.state = "ALIGN_FACE";
        session.sessionId = null;
        session.baseFrame = null;
        session.consecutiveGoodFrames = 0;
        session.countdownSec = 3;
        session.isProcessingAi = false;
        session.blinkCounter = 0;
        session.blinkState = false;
        session.baselineEar = 0.28;
        session.isRecording = false;
        session.recordingFrames = [];
        sendWsRender(session.socket, {
            prompt: "Vui lòng đưa mặt vào giữa khung oval",
            ovalState: "",
            stageTurn: false,
            countdown: 0,
            arrow: null,
            progress: null,
            result: { show: false },
            recordAction: "CANCEL"
        }, {
            type: "AI_RESTART"
        });
    } else if (msg.action === "stop") {
        if (session.countdownTimer) {
            clearInterval(session.countdownTimer);
            session.countdownTimer = null;
        }
        session.isRecording = false;
        session.recordingFrames = [];
        session.state = "COMPLETED";
    }
}

/**
 * Gọi REST API sang Python FastAPI AI Server (port 8000)
 */
async function callAiJson(endpoint, bodyObj, timeoutMs = 4000) {
    const aiServerHost = process.env.AI_SERVER_HOST || "127.0.0.1";
    const aiServerPort = parseInt(process.env.AI_SERVER_PORT || "8000", 10);
    const url = `http://${aiServerHost}:${aiServerPort}${endpoint}`;

    try {
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), timeoutMs);

        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(bodyObj),
            signal: controller.signal
        });
        clearTimeout(tid);

        if (!res.ok) {
            const errText = await res.text();
            return { ok: false, status: res.status, error: errText };
        }
        const data = await res.json();
        return { ok: true, data };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

/**
 * Điều phối truyền frame nhận từ ESP32 sang AI và trả kết quả về cho client qua WS
 */
function dispatchFrameToAiSessions(frameBuffer) {
    if (clientKycSessions.size === 0) return;

    const now = Date.now();

    for (const [socket, session] of clientKycSessions.entries()) {
        if (!socket || socket.destroyed || !socket.writable) {
            clientKycSessions.delete(socket);
            continue;
        }

        // 1. Ghi hình video phiên KYC phía Server (chỉ lưu frame khi đã vào đếm ngược & thử thách)
        if (session.isRecording) {
            // Throttling ~15 FPS (65ms / frame) để video mượt mà và tiết kiệm RAM
            if (now - session.lastRecordedFrameTime >= 65) {
                session.lastRecordedFrameTime = now;
                session.recordingFrames.push(frameBuffer);
            }
        }

        if (session.isProcessingAi) continue;
        if (session.state === "COMPLETED" || session.state === "INIT_SESSION" || session.state === "VERIFYING") continue;

        // Throttling ~5-6 fps (160ms) để không làm quá tải CPU/GPU AI
        if (now - session.lastAiCallTime < 160) continue;

        executeAiStepForSession(session, frameBuffer);
    }
}

/**
 * Thực thi kiểm tra AI theo trạng thái của phiên KYC
 */
async function executeAiStepForSession(session, frameBuffer) {
    if (session.isProcessingAi) return;
    session.isProcessingAi = true;
    session.lastAiCallTime = Date.now();

    try {
        const base64Img = frameBuffer.toString("base64");

        // -------------------------------------------------------------
        // BƯỚC 1: CĂN CHỈNH KHUÔN MẶT (ALIGN_FACE)
        // -------------------------------------------------------------
        if (session.state === "ALIGN_FACE") {
            const res = await callAiJson("/api/v1/validate-pose", { image_base64: base64Img }, 2500);
            if (!res.ok) {
                sendWsRender(session.socket, {
                    prompt: "Đang đợi AI Server phản hồi...",
                    ovalState: "state-warning"
                }, {
                    type: "AI_STATUS",
                    status: "ai_waiting",
                    message: "Đang đợi AI Server phản hồi..."
                });
                return;
            }

            const data = res.data;
            const isAlignedGood = Boolean(
                data.is_aligned_good ||
                (data.fit_oval && data.face_in_oval && data.is_valid && !data.is_occluded)
            );

            let prompt = "Vui lòng đưa mặt vào giữa khung oval";
            let ovalState = "";

            if (!data.has_face || data.num_faces === 0) {
                session.consecutiveGoodFrames = 0;
                prompt = "Vui lòng đưa mặt vào giữa khung oval";
                ovalState = "";
            } else if (data.num_faces > 1) {
                session.consecutiveGoodFrames = 0;
                prompt = "Vui lòng chỉ 1 người trước camera";
                ovalState = "state-danger";
            } else if (data.is_occluded) {
                session.consecutiveGoodFrames = 0;
                prompt = "Vui lòng không che mặt";
                ovalState = "state-danger";
            } else if (isAlignedGood) {
                session.consecutiveGoodFrames++;
                prompt = "Giữ yên khuôn mặt...";
                ovalState = "state-aligned";

                if (session.consecutiveGoodFrames >= 3) {
                    session.state = "COUNTDOWN";
                    session.countdownSec = 3;
                    // BẮT ĐẦU GHI HÌNH PHÍA SERVER (Lưu từ khi bắt đầu đếm ngược 3s)
                    session.isRecording = true;
                    session.recordingFrames = [frameBuffer];
                    session.lastRecordedFrameTime = Date.now();

                    session.countdownTimer = setInterval(() => {
                        session.countdownSec--;
                        if (session.countdownSec > 0) {
                            sendWsRender(session.socket, {
                                prompt: `Giữ yên khuôn mặt (${session.countdownSec}s)...`,
                                ovalState: "state-aligned",
                                countdown: session.countdownSec,
                                sound: "beep"
                            }, {
                                type: "AI_COUNTDOWN_TICK",
                                sec: session.countdownSec
                            });
                        } else {
                            clearInterval(session.countdownTimer);
                            session.countdownTimer = null;
                            initKycSessionWithAi(session, frameBuffer);
                        }
                    }, 800);

                    sendWsRender(session.socket, {
                        prompt: "Giữ yên khuôn mặt (3s)...",
                        ovalState: "state-aligned",
                        countdown: 3,
                        sound: "beep",
                        recordAction: "START"
                    }, {
                        type: "AI_COUNTDOWN_START",
                        sec: 3
                    });
                    return;
                }
            } else {
                session.consecutiveGoodFrames = 0;
                if (!data.face_in_oval) {
                    prompt = "Vui lòng đưa mặt vào giữa khung oval";
                    ovalState = "state-warning";
                } else if (data.is_off_center) {
                    prompt = "Vui lòng căn mặt vào giữa khung oval";
                    ovalState = "state-warning";
                } else if (data.is_too_far) {
                    prompt = "Vui lòng tiến lại gần camera hơn";
                    ovalState = "state-warning";
                } else if (data.is_too_close) {
                    prompt = "Vui lòng lùi ra xa camera một chút";
                    ovalState = "state-warning";
                } else {
                    prompt = "Vui lòng nhìn thẳng vào camera";
                    ovalState = "state-warning";
                }
            }

            sendWsRender(session.socket, {
                prompt,
                ovalState,
                countdown: 0,
                stageTurn: false,
                arrow: null,
                progress: null
            }, {
                type: "AI_POSE_UPDATE",
                data: {
                    has_face: data.has_face,
                    num_faces: data.num_faces,
                    face_in_oval: data.face_in_oval,
                    fit_oval: data.fit_oval,
                    is_aligned_good: isAlignedGood,
                    is_occluded: data.is_occluded,
                    is_too_far: data.is_too_far,
                    is_too_close: data.is_too_close,
                    is_off_center: data.is_off_center
                }
            });
        }
        // -------------------------------------------------------------
        // TRONG LÚC ĐẾM NGƯỢC (COUNTDOWN)
        // -------------------------------------------------------------
        else if (session.state === "COUNTDOWN") {
            const res = await callAiJson("/api/v1/validate-pose", { image_base64: base64Img }, 2000);
            if (res.ok) {
                const data = res.data;
                const isAlignedGood = Boolean(
                    data.is_aligned_good ||
                    (data.fit_oval && data.face_in_oval && data.is_valid && !data.is_occluded)
                );
                if (!isAlignedGood || !data.face_in_oval || data.is_off_center || !data.has_face || data.num_faces > 1) {
                    if (session.countdownTimer) {
                        clearInterval(session.countdownTimer);
                        session.countdownTimer = null;
                    }
                    session.state = "ALIGN_FACE";
                    session.consecutiveGoodFrames = 0;
                    session.countdownSec = 3;
                    session.isRecording = false;
                    session.recordingFrames = [];
                    sendWsRender(session.socket, {
                        prompt: "Vui lòng đưa mặt vào giữa khung oval",
                        ovalState: "state-warning",
                        countdown: 0,
                        sound: "warn",
                        recordAction: "CANCEL"
                    }, {
                        type: "AI_COUNTDOWN_CANCEL"
                    });
                }
            }
        }
        // -------------------------------------------------------------
        // BƯỚC 2: THỬ THÁCH CHỚP MẮT (CHALLENGE_BLINK)
        // -------------------------------------------------------------
        else if (session.state === "CHALLENGE_BLINK") {
            const elapsedSec = (Date.now() - session.challengeStartTime) / 1000;
            if (elapsedSec > 10.0) {
                session.state = "COMPLETED";
                session.isRecording = false;
                const framesToCompile = (session.recordingFrames || []).slice();
                session.recordingFrames = [];

                let videoUrl = null;
                if (framesToCompile.length > 0) {
                    const vidRes = await compileSessionVideo(session.sessionId || session.id, framesToCompile, false);
                    if (vidRes) videoUrl = vidRes.url;
                }

                sendWsRender(session.socket, {
                    prompt: "Hết thời gian chớp mắt",
                    ovalState: "state-danger",
                    countdown: 0,
                    sound: "fail",
                    result: {
                        show: true,
                        success: false,
                        title: "Xác Thực Thất Bại",
                        desc: "Hết thời gian thực hiện chớp mắt. Vui lòng bấm thử lại bên dưới.",
                        cropImage: null,
                        videoUrl
                    },
                    recordAction: "STOP"
                }, {
                    type: "AI_SESSION_FAILED",
                    reason: "Hết thời gian thực hiện chớp mắt",
                    videoUrl
                });
                return;
            }

            const res = await callAiJson("/api/v1/liveness/blink-frame", {
                image_base64: base64Img,
                session_id: session.sessionId,
                blink_counter: session.blinkCounter,
                blink_state: session.blinkState,
                baseline_ear: session.baselineEar
            }, 2500);

            if (res.ok) {
                const data = res.data;
                if (data.person_left_oval || data.reset_to_step === "face_detect" || data.same_person === false) {
                    session.state = "ALIGN_FACE";
                    session.consecutiveGoodFrames = 0;
                    session.isRecording = false;
                    session.recordingFrames = [];
                    sendWsRender(session.socket, {
                        prompt: "Vui lòng đưa mặt vào giữa khung oval",
                        ovalState: "state-warning",
                        countdown: 0,
                        sound: "warn",
                        recordAction: "CANCEL"
                    }, {
                        type: "AI_RESTART"
                    });
                    return;
                }

                if (data.is_occluded) {
                    sendWsRender(session.socket, {
                        prompt: "Vui lòng không che mặt",
                        ovalState: "state-danger",
                        countdown: 0
                    }, {
                        type: "AI_PROMPT_UPDATE"
                    });
                    return;
                }

                if (data.blink_counter !== undefined) session.blinkCounter = data.blink_counter;
                if (data.blink_state !== undefined) session.blinkState = data.blink_state;
                if (data.baseline_ear !== undefined) session.baselineEar = data.baseline_ear;

                const prompt = session.blinkState ? "Vui lòng mở mắt" : "Vui lòng chớp mắt";

                if (data.passed) {
                    session.blinkPassed = true;
                    sendWsRender(session.socket, {
                        prompt: "Đã hoàn thành chớp mắt!",
                        ovalState: "state-aligned",
                        countdown: 0,
                        sound: "good"
                    }, {
                        type: "AI_BLINK_PASSED"
                    });

                    // Bắt đầu thử thách quay đầu
                    let headAction = "turn_right";
                    const startHeadRes = await callAiJson("/api/v1/liveness/start-head", {}, 2000);
                    if (startHeadRes.ok && startHeadRes.data && startHeadRes.data.action) {
                        headAction = startHeadRes.data.action;
                    }
                    session.headAction = headAction;
                    session.state = "CHALLENGE_HEAD";
                    session.challengeStartTime = Date.now();

                    const isTurnLeft = headAction.includes("left");
                    sendWsRender(session.socket, {
                        prompt: isTurnLeft ? "Vui lòng quay mặt sang trái" : "Vui lòng quay mặt sang phải",
                        ovalState: "state-challenge",
                        stageTurn: true,
                        arrow: isTurnLeft ? "left" : "right",
                        progress: 0,
                        countdown: 0,
                        sound: "ding"
                    }, {
                        type: "AI_STEP_CHANGE",
                        step: 3,
                        action: headAction
                    });
                } else {
                    sendWsRender(session.socket, {
                        prompt,
                        ovalState: "state-challenge",
                        countdown: 0
                    }, {
                        type: "AI_BLINK_UPDATE",
                        blink_counter: session.blinkCounter,
                        blink_state: session.blinkState
                    });
                }
            }
        }
        // -------------------------------------------------------------
        // BƯỚC 3: THỬ THÁCH QUAY ĐẦU (CHALLENGE_HEAD)
        // -------------------------------------------------------------
        else if (session.state === "CHALLENGE_HEAD") {
            const elapsedSec = (Date.now() - session.challengeStartTime) / 1000;
            if (elapsedSec > 10.0) {
                session.state = "COMPLETED";
                session.isRecording = false;
                const framesToCompile = (session.recordingFrames || []).slice();
                session.recordingFrames = [];

                let videoUrl = null;
                if (framesToCompile.length > 0) {
                    const vidRes = await compileSessionVideo(session.sessionId || session.id, framesToCompile, false);
                    if (vidRes) videoUrl = vidRes.url;
                }

                sendWsRender(session.socket, {
                    prompt: "Hết thời gian quay đầu",
                    ovalState: "state-danger",
                    stageTurn: false,
                    arrow: null,
                    progress: null,
                    sound: "fail",
                    result: {
                        show: true,
                        success: false,
                        title: "Xác Thực Thất Bại",
                        desc: "Hết thời gian thử thách quay đầu. Vui lòng bấm thử lại bên dưới.",
                        cropImage: null,
                        videoUrl
                    },
                    recordAction: "STOP"
                }, {
                    type: "AI_SESSION_FAILED",
                    reason: "Hết thời gian thử thách quay đầu",
                    videoUrl
                });
                return;
            }

            const res = await callAiJson("/api/v1/liveness/update-head", {
                image_base64: base64Img,
                session_id: session.sessionId
            }, 2500);

            if (res.ok) {
                const data = res.data;
                if (data.state === "RESET" || data.person_left_oval || data.person_swapped || data.same_person === false) {
                    session.state = "ALIGN_FACE";
                    session.consecutiveGoodFrames = 0;
                    session.isRecording = false;
                    session.recordingFrames = [];
                    sendWsRender(session.socket, {
                        prompt: "Vui lòng đưa mặt vào giữa khung oval",
                        ovalState: "state-warning",
                        stageTurn: false,
                        arrow: null,
                        progress: null,
                        sound: "warn",
                        recordAction: "CANCEL"
                    }, {
                        type: "AI_RESTART"
                    });
                    return;
                }

                if (data.is_occluded) {
                    sendWsRender(session.socket, {
                        prompt: "Vui lòng không che mặt",
                        ovalState: "state-danger"
                    }, {
                        type: "AI_PROMPT_UPDATE"
                    });
                    return;
                }

                const isTurnLeft = session.headAction.includes("left");
                const progressPct = Math.min(100, Math.round((data.progress || 0) * 100));
                const prompt = data.is_matched
                    ? "Giữ nguyên góc mặt..."
                    : (isTurnLeft ? "Vui lòng quay mặt sang trái" : "Vui lòng quay mặt sang phải");

                if (data.passed) {
                    session.headPassed = true;
                    session.state = "VERIFYING";

                    sendWsRender(session.socket, {
                        prompt: "Đã hoàn thành quay mặt. Đang xác thực chống giả mạo...",
                        ovalState: "state-aligned",
                        stageTurn: false,
                        arrow: null,
                        progress: 100,
                        sound: "good"
                    }, {
                        type: "AI_HEAD_PASSED"
                    });

                    // Chạy thẩm định Ensemble Anti-Spoofing cuối cùng
                    executeFinalVerifyWithAi(session);
                } else {
                    sendWsRender(session.socket, {
                        prompt,
                        ovalState: data.is_matched ? "state-aligned" : "state-challenge",
                        stageTurn: true,
                        arrow: isTurnLeft ? "left" : "right",
                        progress: progressPct,
                        countdown: 0
                    }, {
                        type: "AI_HEAD_UPDATE",
                        progress: progressPct,
                        is_matched: data.is_matched
                    });
                }
            }
        }
    } catch (err) {
        console.error("[KYC AI DISPATCH ERROR]", err);
    } finally {
        session.isProcessingAi = false;
    }
}

/**
 * Khởi tạo session Liveness với AI bằng ảnh Base Frame
 */
async function initKycSessionWithAi(session, baseFrameBuffer) {
    session.baseFrame = baseFrameBuffer;
    session.state = "INIT_SESSION";

    sendWsRender(session.socket, {
        prompt: "Đang ghi nhận hình ảnh...",
        ovalState: "state-aligned",
        countdown: 0,
        stageTurn: false,
        arrow: null,
        progress: null
    }, {
        type: "AI_PROMPT_UPDATE"
    });

    const res = await callAiJson("/api/v1/liveness/init-session", {
        image_base64: baseFrameBuffer.toString("base64")
    }, 4000);

    if (res.ok && res.data && res.data.success && res.data.session_id) {
        session.sessionId = res.data.session_id;
        session.state = "CHALLENGE_BLINK";
        session.blinkCounter = 0;
        session.blinkState = false;
        session.baselineEar = 0.28;
        session.challengeStartTime = Date.now();

        sendWsRender(session.socket, {
            prompt: "Vui lòng chớp mắt",
            ovalState: "state-challenge",
            stageTurn: false,
            countdown: 0,
            arrow: null,
            progress: null,
            sound: "ding"
        }, {
            type: "AI_STEP_CHANGE",
            step: 2,
            sessionId: session.sessionId
        });
    } else {
        session.state = "ALIGN_FACE";
        session.consecutiveGoodFrames = 0;
        sendWsRender(session.socket, {
            prompt: "Không thể khởi tạo phiên, vui lòng thử lại",
            ovalState: "state-warning",
            sound: "warn",
            recordAction: "CANCEL"
        }, {
            type: "AI_RESTART"
        });
    }
}

/**
 * Thẩm định Ensemble Anti-Spoofing (YOLOv4 + RF-DETR) và gửi kết quả về Web Client
 */
async function executeFinalVerifyWithAi(session) {
    session.state = "VERIFYING";
    session.isRecording = false;
    const framesToCompile = (session.recordingFrames || []).slice();
    session.recordingFrames = [];

    const verifyPayload = {
        image_base64: session.baseFrame ? session.baseFrame.toString("base64") : "",
        session_id: session.sessionId,
        blink_passed: true,
        blink_count: Math.max(1, session.blinkCounter || 1),
        head_passed: true,
        head_action: session.headAction || "turn_right",
        user_id: "kiosk_user",
        apply_oval_mask: true
    };

    // Biên dịch video song song khi AI đang thẩm định chống giả mạo
    const [res, videoResult] = await Promise.all([
        callAiJson("/api/v1/verify", verifyPayload, 6000),
        framesToCompile.length > 0
            ? compileSessionVideo(session.sessionId || session.id, framesToCompile, true)
            : Promise.resolve(null)
    ]);
    session.state = "COMPLETED";

    const videoUrl = videoResult ? videoResult.url : null;

    if (res.ok && res.data) {
        const data = res.data;
        const approved = Boolean(data.approved || data.verdict === "APPROVED");
        const cropFace = data.crop_face_base64 ? `data:image/jpeg;base64,${data.crop_face_base64}` : null;
        const annotatedImg = data.annotated_image_base64 ? `data:image/jpeg;base64,${data.annotated_image_base64}` : null;
        const displayImg = cropFace || annotatedImg || null;
        const reasonText = (data.reasons && data.reasons.length) ? data.reasons.join(" · ") : null;

        sendWsRender(session.socket, {
            prompt: approved ? "Xác thực thành công!" : "Xác thực không đạt",
            ovalState: approved ? "state-aligned" : "state-danger",
            stageTurn: false,
            countdown: 0,
            arrow: null,
            progress: null,
            sound: approved ? "success" : "fail",
            result: {
                show: true,
                success: approved,
                title: approved ? "Xác Thực Thành Công" : "Xác Thực Thất Bại",
                desc: approved
                    ? (reasonText ? `${reasonText} — ` : "") + "Khuôn mặt hợp lệ! Đang chuyển sang mở tủ gửi hàng..."
                    : (reasonText || "Không vượt qua kiểm tra chống giả mạo. Vui lòng thử lại."),
                cropImage: displayImg,
                videoUrl: videoUrl,
                redirectUrl: approved ? "/locker" : null
            },
            recordAction: "STOP"
        }, {
            type: "AI_VERIFICATION_COMPLETE",
            approved,
            videoUrl,
            verdict: data.verdict || (approved ? "APPROVED" : "REJECTED"),
            confidence: data.confidence || 0.95,
            reasons: data.reasons || [],
            crop_face_base64: data.crop_face_base64 || null,
            annotated_image_base64: data.annotated_image_base64 || null
        });
    } else {
        sendWsRender(session.socket, {
            prompt: "Xác thực thất bại",
            ovalState: "state-danger",
            stageTurn: false,
            countdown: 0,
            arrow: null,
            progress: null,
            sound: "fail",
            result: {
                show: true,
                success: false,
                title: "Xác Thực Thất Bại",
                desc: "Lỗi kết nối tới máy chủ AI hoặc phản hồi quá giờ. Vui lòng bấm thử lại.",
                cropImage: null,
                videoUrl: videoUrl,
                redirectUrl: null
            },
            recordAction: "STOP"
        }, {
            type: "AI_VERIFICATION_COMPLETE",
            approved: false,
            videoUrl,
            verdict: "REJECTED",
            confidence: 0.0,
            reasons: ["AI_TIMEOUT_OR_ERROR"],
            crop_face_base64: null,
            annotated_image_base64: null
        });
    }
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
            dispatchFrameToAiSessions(buffer);
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
        "Connection": "keep-alive",
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
