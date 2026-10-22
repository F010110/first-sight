#include <Arduino.h>
#include "esp_camera.h"
#ifdef FIRST_SIGHT_PORTAL
#include "portal_camera.h"
#endif
#ifdef FIRST_SIGHT_WIFI
#include "wifi_transport.h"
#endif

bool ready = false;
uint32_t serialBaud = 115200;
void setup() {
  Serial.begin(115200);
  delay(1500);
  Serial.printf("TEST PSRAM=%u FLASH=%u\n", ESP.getPsramSize(), ESP.getFlashChipSize());
  camera_config_t c = {};
  c.ledc_channel = LEDC_CHANNEL_0;
  c.ledc_timer = LEDC_TIMER_0;
  c.pin_d0=11; c.pin_d1=9; c.pin_d2=8; c.pin_d3=10;
  c.pin_d4=12; c.pin_d5=18; c.pin_d6=17; c.pin_d7=16;
  c.pin_xclk=15; c.pin_pclk=13; c.pin_vsync=6; c.pin_href=7;
  c.pin_sccb_sda=4; c.pin_sccb_scl=5;
  c.pin_pwdn=-1; c.pin_reset=-1;
  c.xclk_freq_hz=20000000;
  c.pixel_format=PIXFORMAT_JPEG;
  c.frame_size=FRAMESIZE_VGA;
  c.jpeg_quality=12; c.fb_count=1;
  c.fb_location=CAMERA_FB_IN_PSRAM;
  c.grab_mode=CAMERA_GRAB_WHEN_EMPTY;
  esp_err_t err=esp_camera_init(&c);
  Serial.printf("CAMERA_INIT=0x%x\n", err);
  if(err!=ESP_OK) return;
  sensor_t *s=esp_camera_sensor_get();
  Serial.printf("SENSOR_PID=0x%04x\n", s->id.PID);
  ready=true;
  Serial.println("READY: send c to capture");
#ifdef FIRST_SIGHT_PORTAL
  portalCameraSetup();
#endif
#ifdef FIRST_SIGHT_WIFI
  wifiSetup();
#endif
}
void loop() {
#ifdef FIRST_SIGHT_PORTAL
  if(ready)portalCameraLoop();else delay(100);
  return;
#endif
#ifdef FIRST_SIGHT_WIFI
  if(ready)wifiLoop();else delay(100);
  return;
#endif
  if(!Serial.available()) { delay(10); return; }
  int command = Serial.read();
  // Boot/reboot always uses 115200; switching is explicit and acknowledged
  // at BOTH rates. Existing single-frame command and JPEG settings are intact.
  if(command=='b') {
    String value=Serial.readStringUntil('\n'); value.trim();
    uint32_t target=value.toInt();
    if(value!=String(target) || (target!=115200 && target!=230400 && target!=460800)) {
      Serial.println("BAUD_REJECTED"); return;
    }
    Serial.printf("BAUD_SWITCH %u\n",target); Serial.flush();
    delay(100);
    Serial.updateBaudRate(target); serialBaud=target;
    delay(200);
    Serial.printf("BAUD_READY %u\n",serialBaud); Serial.flush();
    return;
  }
  if(command=='c') {
    if(!ready) { Serial.println("CAMERA_NOT_READY"); return; }
    for(int i=0;i<3;i++) { camera_fb_t *f=esp_camera_fb_get(); if(f) esp_camera_fb_return(f); delay(100); }
    camera_fb_t *f=esp_camera_fb_get();
    if(!f) { Serial.println("CAPTURE_FAILED"); return; }
    Serial.printf("FRAME %u %u %u\n", f->len, f->width, f->height);
    Serial.write(f->buf,f->len);
    Serial.flush();
    Serial.println("\nEND_FRAME");
    esp_camera_fb_return(f);
  }
  delay(10);
}
