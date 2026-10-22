#include "portal_session.h"
void setup(){Serial.begin(115200);delay(1500);portalConnect();Serial.println("PROBE_DONE RADIO_OFF");WiFi.disconnect(true);WiFi.mode(WIFI_OFF);}
void loop(){delay(1000);}
