#ifndef CONFIG_H
#define CONFIG_H

// WiFi
#define WIFI_SSID "2D11"
#define WIFI_PASSWORD "vpkhoavtq92d11"

// MQTT Broker
#define MQTT_SERVER "broker.emqx.io"
#define MQTT_PORT 1883

#define MQTT_USER ""
#define MQTT_PASSWORD ""

// MQTT Topics
#define MQTT_TOPIC_PUB "SMART_LOCKER/ESP32/STATUS" // Trạng thái ESP ON - OFF
#define MQTT_TOPIC_LOCKER_CMD "SMART_LOCKER/LOCKER/CMD" // Lệnh điều khiển khóa từ NodeJS
#define MQTT_TOPIC_SUB "SMART_LOCKER/LOCKER/STATE" // Trạng thái của tủ (Đóng, mở,...)
#define MQTT_TOPIC_LOCKER_ACK "SMART_LOCKER/LOCKER/ACK" // ACK từ ESP32 về NodeJS sau khi nhận lệnh khóa

// GPIO Pins
#define JGY370_PIN 1
#define SERVO_PIN 2
#define LW_KHAY_GOC 41
#define LW_DEM_KHAY 42
#define LW_SERVO 47
#define LW_CUA 21

// Servo angles & Locker config
#define SERVO_LOCKED_ANGLE 0      // Góc đóng chốt khóa (đóng cửa)
#define SERVO_UNLOCKED_ANGLE 90   // Góc mở chốt khóa (mở cửa)
#define TOTAL_TRAYS 6             // Tổng số 6 khay tủ (1 - 6)
#define TRAY_STOP_DELAY_MS 1500   // Thời gian dừng lại tại mỗi khay trước khi chuyển tiếp (1.5 giây)

#endif