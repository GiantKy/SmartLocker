#ifndef LIMIT_SWITCH_H
#define LIMIT_SWITCH_H

#include <Arduino.h>

class LimitSwitch
{
private:
    uint8_t _pin;
    bool _pressed;

public:
    // Constructor
    LimitSwitch(uint8_t pin);

    // Khởi tạo cảm biến
    void begin();

    // Đọc trạng thái cảm biến
    bool isPressed();

    // Lấy trạng thái hiện tại
    bool getState();
};

#endif