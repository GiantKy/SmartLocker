#include "JGY370.h"

JGY370::JGY370(uint8_t pwmPin)
{
    _pin = pwmPin;
}

void JGY370::begin()
{
    pinMode(_pin, OUTPUT);
    stop();
}

void JGY370::run()
{
    digitalWrite(_pin, HIGH);
    analogWrite(_pin, 255);
}

void JGY370::stop()
{
    digitalWrite(_pin, LOW);
    analogWrite(_pin, 0);
}