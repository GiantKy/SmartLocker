#include <Arduino.h>
#include <WIFI.h>

#include "sensors/LimitSwitch/LimitSwitch.h"
#include "actuators/ServoMotor/ServoMotor.h"
#include "actuators/JGY370/JGY370.h"

#include "Config.h"
#include "MQTTManager.h"

MQTTManager mqtt(
    MQTT_SERVER,
    MQTT_PORT,
    MQTT_USER,
    MQTT_PASSWORD,
    MQTT_TOPIC_PUB,
    MQTT_TOPIC_SUB
);

LimitSwitch lwKhayGoc = LimitSwitch(LW_KHAY_GOC);
LimitSwitch lwDemKhay = LimitSwitch(LW_DEM_KHAY);
LimitSwitch lwServo = LimitSwitch(LW_SERVO);
LimitSwitch lwCua = LimitSwitch(LW_CUA);

JGY370 motorJGY370 = JGY370(JGY370_PIN);

ServoMotor servoCua = ServoMotor(SERVO_PIN);

// Hàm xử lý dữ liệu nhận được từ MQTT tại main
void handleMQTTMessage(char* topic, String message)
{
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

    lwKhayGoc.begin();
    lwDemKhay.begin();
    lwServo.begin();
    lwCua.begin();

    motorJGY370.begin();

    servoCua.begin();
}

void loop()
{
    // Duy trì MQTT và nhận dữ liệu
    mqtt.loop();
}