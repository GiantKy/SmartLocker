#ifndef SERVO_MOTOR_H
#define SERVO_MOTOR_H

#include <Arduino.h>
#include <ESP32Servo.h>

class ServoMotor
{
private:
    uint8_t _pin;
    Servo _servo;

    int _currentAngle;

public:
    ServoMotor(uint8_t pin);

    void begin();

    void writeAngle(int angle);

    int getAngle();

    void detach();
};

#endif