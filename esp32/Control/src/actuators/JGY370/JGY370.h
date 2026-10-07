#ifndef JGY370_H
#define JGY370_H

#include <Arduino.h>

class JGY370
{
private:
    uint8_t _pin;

public:
    JGY370(uint8_t pwmPin);

    void begin();

    void run();

    void stop();
};

#endif