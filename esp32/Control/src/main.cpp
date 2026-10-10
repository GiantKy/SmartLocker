#include <Arduino.h>
#include <WiFi.h>

#include "sensors/LimitSwitch/LimitSwitch.h"
#include "actuators/ServoMotor/ServoMotor.h"
#include "actuators/JGY370/JGY370.h"

#include "Config.h"
#include "MQTTManager.h"

// MQTT Manager lắng nghe lệnh trên MQTT_TOPIC_LOCKER_CMD ("SMART_LOCKER/LOCKER/CMD")
MQTTManager mqtt(
    MQTT_SERVER,
    MQTT_PORT,
    MQTT_USER,
    MQTT_PASSWORD,
    MQTT_TOPIC_PUB,
    MQTT_TOPIC_LOCKER_CMD
);

// Cảm biến công tắc hành trình
LimitSwitch lwKhayGoc = LimitSwitch(LW_KHAY_GOC);   // Báo vị trí khay số 1 (Home)
LimitSwitch lwDemKhay = LimitSwitch(LW_DEM_KHAY);   // Đếm bước chuyển từng khay
LimitSwitch lwServo   = LimitSwitch(LW_SERVO);      // Báo trạng thái chốt servo
LimitSwitch lwCua     = LimitSwitch(LW_CUA);        // Báo trạng thái mở / đóng cửa

// Cơ cấu truyền động
JGY370 motorJGY370 = JGY370(JGY370_PIN);           // Động cơ xoay cụm khay tủ
ServoMotor servoCua = ServoMotor(SERVO_PIN);       // Servo khóa / mở chốt cửa tủ

// Trạng thái hệ thống
int currentTray = 1;                                // Khay hiện tại đang ở vị trí cửa (1 - 6)
bool isDoorOpen = false;                            // Trạng thái cửa (true: mở, false: đóng)
unsigned long lastHeartbeat = 0;                    // Thời gian gửi nhịp tim trạng thái

// Khai báo trước các hàm điều khiển
void rotateToTray(int targetTray);
void openLockerDoor(int trayId);
void closeLockerDoor(int trayId);

/**
 * Xoay cụm khay tủ tới khay chỉ định (1 -> 6)
 * @param targetTray Khay đích cần xoay tới
 */
void rotateToTray(int targetTray)
{
    if (targetTray < 1 || targetTray > TOTAL_TRAYS)
    {
        Serial.printf("[LOCKER] Khay dich %d khong hop le (1 -> %d)!\n", targetTray, TOTAL_TRAYS);
        return;
    }

    if (targetTray == currentTray)
    {
        Serial.printf("[LOCKER] He thong da o dung vi tri khay %d. Khong can quay.\n", targetTray);
        return;
    }

    // Đảm bảo servo chốt cửa đã đóng an toàn trước khi quay cơ cấu
    servoCua.writeAngle(SERVO_LOCKED_ANGLE);
    delay(200);

    int stepsToMove = (targetTray - currentTray + TOTAL_TRAYS) % TOTAL_TRAYS;
    Serial.println("----------------------------------------------");
    Serial.printf("[LOCKER] Bat dau xoay tu khay %d den khay %d (%d buoc)...\n",
                  currentTray, targetTray, stepsToMove);
    Serial.println("----------------------------------------------");

    // Khởi động động cơ JGY370
    motorJGY370.run();

    unsigned long startTime = millis();
    unsigned long maxTimeout = (unsigned long)stepsToMove * (4000 + TRAY_STOP_DELAY_MS) + 3000; // Timeout bảo vệ an toàn
    int stepCount = 0;
    bool wasPressed = lwDemKhay.isPressed();

    while (stepCount < stepsToMove)
    {
        mqtt.loop(); // Duy trì kết nối MQTT trong khi motor hoạt động

        // Nếu chạm công tắc khay gốc thì đồng bộ chính xác về khay 1
        if (lwKhayGoc.isPressed())
        {
            currentTray = 1;
        }

        // Bắt cạnh kích hoạt của công tắc đếm khay
        bool isPressed = lwDemKhay.isPressed();
        if (isPressed && !wasPressed)
        {
            stepCount++;
            currentTray = (currentTray % TOTAL_TRAYS) + 1;
            Serial.printf("[SENSOR] Phat hien den khay: %d (Buoc %d/%d)\n",
                          currentTray, stepCount, stepsToMove);

            // Dừng động cơ tại khay này
            motorJGY370.stop();

            if (currentTray == targetTray)
            {
                Serial.printf("[LOCKER] Da den dung khay dich %d!\n", targetTray);
                break;
            }
            else
            {
                // Dừng lại 1.5 giây sau đó mới chuyển tới khay tiếp theo
                Serial.printf("[LOCKER] Dung lai %.1fs tai khay %d truoc khi tiep tuc sang khay tiep theo...\n",
                              (float)TRAY_STOP_DELAY_MS / 1000.0, currentTray);
                unsigned long pauseStart = millis();
                while (millis() - pauseStart < TRAY_STOP_DELAY_MS)
                {
                    mqtt.loop();
                    delay(10);
                }

                Serial.println("[LOCKER] Tiep tuc quay toi khay tiep theo...");
                motorJGY370.run();
            }

            delay(60); // Debounce chống dội tiếp điểm
        }
        wasPressed = isPressed;

        // Cơ chế bảo vệ timeout nếu cảm biến không phản hồi
        if (millis() - startTime > maxTimeout)
        {
            Serial.println("[CANH BAO] Timeout buoc dem khay! Dung motor de bao ve phan cung.");
            currentTray = targetTray;
            break;
        }

        delay(10);
    }

    // Dừng động cơ
    motorJGY370.stop();
    delay(300);
    Serial.printf("[LOCKER] Hoan tat xoay. Vi tri hien tai: Khay %d\n", currentTray);
}

/**
 * Mở cửa ngăn tủ
 * @param trayId Khay cần mở (1 - 6)
 */
void openLockerDoor(int trayId)
{
    Serial.printf("[LOCKER] >>> Tien hanh MO ngan tu so %d...\n", trayId);

    // 1. Xoay khay đến đúng vị trí nếu cần
    rotateToTray(trayId);

    // 2. Mở chốt servo
    servoCua.writeAngle(SERVO_UNLOCKED_ANGLE);
    isDoorOpen = true;

    Serial.printf("[LOCKER] >>> NGAN TU SO %d DA MO THANH CONG!\n", trayId);

    // 3. Gửi thông báo trạng thái về NodeJS Server
    String statePayload = "{\"action\":\"OPEN\",\"lockerId\":" + String(trayId) + ",\"status\":\"OPENED\",\"door\":\"OPEN\"}";
    mqtt.publish(MQTT_TOPIC_SUB, statePayload.c_str());
}

/**
 * Đóng cửa ngăn tủ
 * @param trayId Khay cần đóng (1 - 6)
 */
void closeLockerDoor(int trayId)
{
    Serial.printf("[LOCKER] >>> Tien hanh DONG ngan tu so %d...\n", trayId);

    // Đóng chốt khóa servo
    servoCua.writeAngle(SERVO_LOCKED_ANGLE);
    isDoorOpen = false;

    Serial.printf("[LOCKER] >>> NGAN TU SO %d DA DONG VA KHOA CHOT!\n", trayId);

    // Gửi thông báo trạng thái về NodeJS Server
    String statePayload = "{\"action\":\"CLOSE\",\"lockerId\":" + String(trayId) + ",\"status\":\"CLOSED\",\"door\":\"CLOSED\"}";
    mqtt.publish(MQTT_TOPIC_SUB, statePayload.c_str());
}

/**
 * Hàm xử lý dữ liệu nhận được từ MQTT Broker
 */
void handleMQTTMessage(char* topic, String message)
{
    Serial.println();
    Serial.println("==========================================");
    Serial.printf("[MQTT RECV] Topic: %s\n", topic);
    Serial.printf("[MQTT RECV] Message: %s\n", message.c_str());
    Serial.println("==========================================");

    // 1. Xác định action ("OPEN" hoặc "CLOSE")
    String action = "";
    if (message.indexOf("OPEN") >= 0 || message.indexOf("open") >= 0)
    {
        action = "OPEN";
    }
    else if (message.indexOf("CLOSE") >= 0 || message.indexOf("close") >= 0)
    {
        action = "CLOSE";
    }

    // 2. Trích xuất lockerId (1 -> 6)
    int targetTray = currentTray;
    int idIdx = message.indexOf("lockerId");
    if (idIdx == -1) idIdx = message.indexOf("id");
    if (idIdx == -1) idIdx = message.indexOf("tray");

    if (idIdx != -1)
    {
        for (unsigned int i = idIdx; i < message.length(); i++)
        {
            if (isDigit(message[i]))
            {
                int val = message[i] - '0';
                if (val >= 1 && val <= TOTAL_TRAYS)
                {
                    targetTray = val;
                    break;
                }
            }
        }
    }
    else
    {
        // Quét tìm chữ số bất kỳ từ 1 -> 6 trong chuỗi
        for (unsigned int i = 0; i < message.length(); i++)
        {
            if (isDigit(message[i]))
            {
                int val = message[i] - '0';
                if (val >= 1 && val <= TOTAL_TRAYS)
                {
                    targetTray = val;
                    break;
                }
            }
        }
    }

    // 3. Gửi ACK phản hồi ngay về cho NodeJS Server
    String ackPayload = "{\"action\":\"" + action + "\",\"lockerId\":" + String(targetTray) + ",\"status\":\"RECEIVED\"}";
    mqtt.publish(MQTT_TOPIC_LOCKER_ACK, ackPayload.c_str());

    // 4. Thực thi hành động tương ứng
    if (action == "OPEN")
    {
        openLockerDoor(targetTray);
    }
    else if (action == "CLOSE")
    {
        closeLockerDoor(targetTray);
    }
    else
    {
        Serial.printf("[MQTT] Lenh khong xac dinh: %s\n", message.c_str());
    }
}

void setup()
{
    Serial.begin(115200);

    // Kết nối WiFi
    WiFi.begin(
        WIFI_SSID,
        WIFI_PASSWORD
    );

    Serial.print("Connecting WiFi");

    while (WiFi.status() != WL_CONNECTED)
    {
        delay(500);
        Serial.print(".");
    }

    Serial.println();
    Serial.println("WiFi Connected");

    Serial.print("IP Address: ");
    Serial.println(WiFi.localIP());

    // Cài đặt callback xử lý MQTT tại main
    mqtt.setCallback(handleMQTTMessage);

    // Khởi tạo MQTT
    mqtt.begin();

    // Kết nối broker
    mqtt.connect();

    // Đăng ký nhận lệnh từ topic CMD
    mqtt.subscribe(MQTT_TOPIC_LOCKER_CMD);

    // Khởi tạo cảm biến
    lwKhayGoc.begin();
    lwDemKhay.begin();
    lwServo.begin();
    lwCua.begin();

    // Khởi tạo động cơ & servo
    motorJGY370.begin();
    servoCua.begin();

    // Đặt servo ở trạng thái khóa chốt ban đầu
    servoCua.writeAngle(SERVO_LOCKED_ANGLE);
    isDoorOpen = false;

    // Kiểm tra vị trí khay gốc ban đầu
    if (lwKhayGoc.isPressed())
    {
        currentTray = 1;
        Serial.println("[INIT] Tu dang o vi tri Khay goc 1.");
    }

    // Gửi trạng thái khởi động ONLINE lên broker
    String initStatus = "{\"status\":\"ONLINE\",\"ip\":\"" + WiFi.localIP().toString() + "\",\"currentTray\":" + String(currentTray) + ",\"door\":\"CLOSED\"}";
    mqtt.publish(MQTT_TOPIC_PUB, initStatus.c_str());

    Serial.println("==========================================");
    Serial.println(" SMART LOCKER ESP32 CONTROLLER SAN SANG!");
    Serial.println("==========================================");
}

void loop()
{
    // Duy trì MQTT và nhận dữ liệu
    mqtt.loop();

    // Nếu công tắc khay gốc được chạm, đồng bộ vị trí về khay 1
    if (lwKhayGoc.isPressed() && currentTray != 1)
    {
        currentTray = 1;
        Serial.println("[HOMING] Cham cong tac khay goc -> Cap nhat ve Khay 1");
    }

    // Kiểm tra công tắc cửa: nếu cửa đóng cơ học khi đang mở
    if (isDoorOpen && lwCua.isPressed())
    {
        Serial.println("[SENSOR] Cua da duoc day dong co hoc! Tien hanh khoa chot...");
        closeLockerDoor(currentTray);
    }

    // Nhịp tim báo cáo trạng thái định kỳ mỗi 15 giây
    unsigned long now = millis();
    if (now - lastHeartbeat >= 15000)
    {
        lastHeartbeat = now;
        String heartbeat = "{\"status\":\"ONLINE\",\"currentTray\":" + String(currentTray) + ",\"door\":\"" + (isDoorOpen ? "OPEN" : "CLOSED") + "\"}";
        mqtt.publish(MQTT_TOPIC_PUB, heartbeat.c_str());
    }
}