#include "MQTTManager.h"

// Khởi tạo instance dùng cho callback
MQTTManager *MQTTManager::_instance = nullptr;

MQTTManager::MQTTManager(
    const char *server,
    uint16_t port,
    const char *username,
    const char *password,
    const char *publishTopic,
    const char *subscribeTopic,
    MQTTCallback callback)
    : _server(server),
      _port(port),
      _username(username),
      _password(password),
      _publishTopic(publishTopic),
      _subscribeTopic(subscribeTopic),
      _wifiClient(),
      _mqttClient(_wifiClient),
      _callback(callback)
{
    _lastReconnectAttempt = 0;

    _instance = this;
}

void MQTTManager::setCallback(MQTTCallback callback)
{
    _callback = callback;
}

void MQTTManager::onMessage(MQTTCallback callback)
{
    _callback = callback;
}

void MQTTManager::begin()
{
    _mqttClient.setServer(_server, _port);

    _mqttClient.setCallback(callbackHandler);

    // Giới hạn kích thước gói MQTT
    _mqttClient.setBufferSize(512);
}

void MQTTManager::begin(MQTTCallback callback)
{
    setCallback(callback);
    begin();
}

void MQTTManager::connect()
{
    if (WiFi.status() != WL_CONNECTED)
    {
        return;
    }

    if (_mqttClient.connected())
    {
        return;
    }

    Serial.println("Connecting to MQTT...");

    // Client ID phải duy nhất trên broker
    String clientId = "ESP32-S3-";
    clientId += WiFi.macAddress();

    bool connected;

    if (strlen(_username) > 0)
    {
        connected = _mqttClient.connect(
            clientId.c_str(),
            _username,
            _password);
    }
    else
    {
        connected = _mqttClient.connect(
            clientId.c_str());
    }

    if (connected)
    {
        Serial.println("MQTT Connected");

        // Đăng ký nhận lệnh
        _mqttClient.subscribe(
            _subscribeTopic);

        Serial.print("Subscribed: ");
        Serial.println(_subscribeTopic);
    }
    else
    {
        Serial.print("MQTT Failed, state: ");
        Serial.println(_mqttClient.state());
    }
}

void MQTTManager::loop()
{
    if (!_mqttClient.connected())
    {
        unsigned long now = millis();

        // Thử kết nối lại mỗi 5 giây
        if (now - _lastReconnectAttempt >= 5000)
        {
            _lastReconnectAttempt = now;

            connect();
        }
    }
    else
    {
        _mqttClient.loop();
    }
}

bool MQTTManager::publish(
    const char *topic,
    const char *message)
{
    if (!_mqttClient.connected())
    {
        return false;
    }

    return _mqttClient.publish(
        topic,
        message);
}

bool MQTTManager::publish(
    const char *message)
{
    return publish(
        _publishTopic,
        message);
}

bool MQTTManager::isConnected()
{
    return _mqttClient.connected();
}

// Callback trung gian
void MQTTManager::callbackHandler(
    char *topic,
    byte *payload,
    unsigned int length)
{
    if (_instance != nullptr)
    {
        _instance->handleMessage(
            topic,
            payload,
            length);
    }
}

// Xử lý dữ liệu nhận được
void MQTTManager::handleMessage(
    char *topic,
    byte *payload,
    unsigned int length)
{
    String message = "";

    for (unsigned int i = 0; i < length; i++)
    {
        message += (char)payload[i];
    }

    Serial.println();
    Serial.println("MQTT Message Received (No custom callback):");
    Serial.print("Topic: ");
    Serial.println(topic);
    Serial.print("Message: ");
    Serial.println(message);

    if (_callback != nullptr)
    {
        _callback(topic, message);
    }
}