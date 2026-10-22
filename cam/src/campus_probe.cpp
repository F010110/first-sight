// Bounded campus 2.4GHz scan: no credentials, association, images or login requests.
#include <Arduino.h>
#include <WiFi.h>
void setup() {
  Serial.begin(115200); delay(1500);
  WiFi.persistent(false); WiFi.mode(WIFI_STA); WiFi.setAutoReconnect(false);
  Serial.println("CAMPUS_PROBE_START");
  // ESP32-S3 scans only 2.4 GHz. Repeat to avoid treating one missed beacon as absence.
  for(int pass=1;pass<=3;pass++) {
    int count=WiFi.scanNetworks(false,true,false,300);
    Serial.printf("SCAN_PASS=%d RESULT=%d\n",pass,count);
    for(int i=0;i<count;i++) {
      String name=WiFi.SSID(i);
      if(name=="BUPT-mobile" || name=="BUPT-portal")
        Serial.printf("CAMPUS_SSID=%s CHANNEL=%d RSSI=%d AUTH=%d\n",name.c_str(),WiFi.channel(i),WiFi.RSSI(i),(int)WiFi.encryptionType(i));
    }
    WiFi.scanDelete(); delay(500);
  }
  Serial.println("SCAN_DONE PROBE_DONE RADIO_OFF"); WiFi.disconnect(true); WiFi.mode(WIFI_OFF);
}
void loop() { delay(1000); }
