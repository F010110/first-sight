#pragma once
// Compiled only by camera-wifi; never flashed or started by the serial workflow.
#include <WiFi.h>
#include <HTTPClient.h>
#include <mbedtls/sha256.h>
#include "../local/wifi-config.h"

static String wifiBoot;
static uint32_t wifiSequence=0;
static long lastRound=-1;
static bool wifiConfigured=false;

static void wifiSetup() {
  static_assert(sizeof(CAMERA_TOKEN)>=25,"Use a random token of at least 24 characters");
  wifiBoot=String(esp_random(),HEX)+String(esp_random(),HEX);
  WiFi.mode(WIFI_STA); WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID,WIFI_PASSWORD);
  wifiConfigured=true;
  Serial.println("WIFI_STA_STARTED; no credentials logged");
}

static void wifiLoop() {
  if(!wifiConfigured||WiFi.status()!=WL_CONNECTED) { delay(250);return; }
  HTTPClient poll;
  poll.setConnectTimeout(1000);poll.setTimeout(1000);
  String endpoint=String(CAMERA_SERVER)+"/v1/next/"+CAMERA_ID+"/"+wifiBoot;
  if(!poll.begin(endpoint)){delay(100);return;}
  poll.addHeader("Authorization",String("Bearer ")+CAMERA_TOKEN);
  int code=poll.GET();String command=code==200?poll.getString():"";poll.end();
  if(code==409){Serial.println("WIFI_SESSION_REJECTED; start a new host recording");delay(1000);return;}
  if(!command.startsWith("CAPTURE ")){delay(40);return;}
  long round=command.substring(8).toInt();
  if(round<0||round<=lastRound){delay(40);return;}
  lastRound=round;
  // Same exposure-update procedure and JPEG configuration as serial capture.
  for(int i=0;i<3;i++){camera_fb_t *old=esp_camera_fb_get();if(old)esp_camera_fb_return(old);delay(100);}
  camera_fb_t *frame=esp_camera_fb_get();
  if(!frame){Serial.println("WIFI_CAPTURE_FAILED");return;}
  // Driver timestamp when available, NOT a clock aligned to other boards.
  uint32_t capturedMs=uint32_t(frame->timestamp.tv_sec*1000ULL+frame->timestamp.tv_usec/1000);
  uint8_t digest[32];char hex[65];
  if(mbedtls_sha256_ret(frame->buf,frame->len,digest,0)!=0){esp_camera_fb_return(frame);return;}
  for(int i=0;i<32;i++)snprintf(hex+i*2,3,"%02x",digest[i]);hex[64]=0;
  HTTPClient upload;upload.setConnectTimeout(1000);upload.setTimeout(1500);
  if(upload.begin(String(CAMERA_SERVER)+"/v1/frame")){
    upload.addHeader("Authorization",String("Bearer ")+CAMERA_TOKEN);
    upload.addHeader("Content-Type","image/jpeg");
    upload.addHeader("X-Camera-Id",CAMERA_ID);upload.addHeader("X-Boot-Id",wifiBoot);
    upload.addHeader("X-Round-Id",String(round));upload.addHeader("X-Sequence",String(wifiSequence++));
    upload.addHeader("X-Capture-Ms",String(capturedMs));upload.addHeader("X-Frame-Sha256",hex);
    int result=upload.POST(frame->buf,frame->len);upload.end();
    Serial.printf("WIFI_UPLOAD round=%ld status=%d\n",round,result);
  }
  esp_camera_fb_return(frame);
}
