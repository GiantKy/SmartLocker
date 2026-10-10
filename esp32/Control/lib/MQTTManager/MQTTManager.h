#ifndef MQTT_MANAGER_H
#define MQTT_MANAGER_H

#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <functional>

// Kiểu dữ liệu callback nhận tin nhắn MQTT
typedef std::function<void(char* topic, String message)> MQTTCallback;

class MQTTManager
{
private:
    const char* _server;
    uint16_t _port;

    const char* _username;
    const char* _password;

    const char* _publishTopic;
    const char* _subscribeTopic;

    WiFiClient _wifiClient;
    PubSubClient _mqttClient;

    unsigned long _lastReconnectAttempt;

    MQTTCallback _callback;

    static MQTTManager* _instance;

    static void callbackHandler(
        char* topic,
        byte* payload,
        unsigned int length
    );

    void handleMessage(
        char* topic,
        byte* payload,
        unsigned int length
    );

public:
    MQTTManager(
        const char* server,
        uint16_t port,
        const char* username,
        const char* password,
        const char* publishTopic,
        const char* subscribeTopic,
        MQTTCallback callback = nullptr
    );

    void setCallback(MQTTCallback callback);
    void onMessage(MQTTCallback callback);

    void begin();
    void begin(MQTTCallback callback);

    void connect();

    void loop();

    bool publish(const char* topic, const char* message);

    bool publish(const char* message);

    bool subscribe(const char* topic);

    bool isConnected();
};

#endif