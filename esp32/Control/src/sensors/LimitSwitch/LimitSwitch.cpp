#include "LimitSwitch.h"

// Constructor
LimitSwitch::LimitSwitch(uint8_t pin)
{
    _pin = pin;
    _pressed = false;
}

// Khởi tạo cảm biến
void LimitSwitch::begin()
{
    pinMode(_pin, INPUT_PULLUP);

    // Đọc trạng thái ban đầu
    _pressed = (digitalRead(_pin) == LOW);
}

// Đọc trạng thái cảm biến
bool LimitSwitch::isPressed()
{
    _pressed = (digitalRead(_pin) == LOW);

    return _pressed;
}

// Lấy trạng thái hiện tại
bool LimitSwitch::getState()
{
    return _pressed;
}