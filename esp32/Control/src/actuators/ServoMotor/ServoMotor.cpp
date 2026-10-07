#include "ServoMotor.h"

ServoMotor::ServoMotor(uint8_t pin)
{
    _pin = pin;
    _currentAngle = 0;
}

void ServoMotor::begin()
{
    // Cấu hình PWM cho servo
    _servo.setPeriodHertz(50);

    // Xung điều khiển servo: 500 - 2400 us
    _servo.attach(_pin, 500, 2400);

    // Đưa servo về góc 0 độ
    writeAngle(0);
}

void ServoMotor::writeAngle(int angle)
{
    // Giới hạn góc từ 0 đến 180
    angle = constrain(angle, 0, 180);

    _servo.write(angle);

    _currentAngle = angle;
}

int ServoMotor::getAngle()
{
    return _currentAngle;
}

void ServoMotor::detach()
{
    _servo.detach();
}