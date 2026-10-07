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
    analogWrite(_pin, 1);
}

void JGY370::stop()
{
    analogWrite(_pin, 0);
}