#pragma once
#include "portal_session.h"
#include <WebServer.h>
#include <mbedtls/sha256.h>
static WebServer cameraServer(80);
static String cameraToken, cameraBoot;
static uint32_t cameraSequence=0, cameraStarted=0;
static bool cameraServing=false;
static void portalCameraSetup(){
  if(!portalConnect()){Serial.println("CAMERA_NETWORK_FAILED");WiFi.mode(WIFI_OFF);return;}
  Serial.println("CAMERA_TOKEN_READY");Serial.setTimeout(60000);cameraToken=Serial.readStringUntil('\n');cameraToken.trim();
  if(cameraToken.length()!=64){Serial.println("CAMERA_TOKEN_INVALID");WiFi.mode(WIFI_OFF);return;}
  for(size_t i=0;i<cameraToken.length();i++)if(!isxdigit(cameraToken[i])){WiFi.mode(WIFI_OFF);return;}
  cameraBoot=String(esp_random(),HEX)+String(esp_random(),HEX);
  const char* keys[]={"Authorization"};cameraServer.collectHeaders(keys,1);
  cameraServer.on("/v1/frame",HTTP_GET,[]{
    if(cameraServer.header("Authorization")!="Bearer "+cameraToken){cameraServer.send(401,"text/plain","Unauthorized");return;}
    for(int i=0;i<3;i++){auto old=esp_camera_fb_get();if(old)esp_camera_fb_return(old);delay(100);}
    auto frame=esp_camera_fb_get();if(!frame){cameraServer.send(503,"text/plain","Capture failed");return;}
    uint8_t digest[32];char hex[65];
    if(mbedtls_sha256_ret(frame->buf,frame->len,digest,0)!=0){esp_camera_fb_return(frame);cameraServer.send(500);return;}
    for(int i=0;i<32;i++)snprintf(hex+i*2,3,"%02x",digest[i]);hex[64]=0;
    cameraServer.sendHeader("X-Frame-Sha256",hex);cameraServer.sendHeader("X-Boot-Id",cameraBoot);
    cameraServer.sendHeader("X-Sequence",String(cameraSequence++));
    cameraServer.sendHeader("X-Capture-Ms",String(uint32_t(frame->timestamp.tv_sec*1000ULL+frame->timestamp.tv_usec/1000)));
    cameraServer.sendHeader("Cache-Control","no-store");cameraServer.setContentLength(frame->len);
    cameraServer.send(200,"image/jpeg","");cameraServer.sendContent((const char*)frame->buf,frame->len);
    esp_camera_fb_return(frame);
  });
  cameraServer.begin();cameraStarted=millis();cameraServing=true;
  Serial.printf("CAMERA_HTTP_READY IP=%s PORT=80 TTL_SECONDS=180\n",WiFi.localIP().toString().c_str());
}
static void portalCameraLoop(){
  if(cameraServing&&millis()-cameraStarted<180000){cameraServer.handleClient();delay(2);}
  else {if(cameraServing){cameraServer.stop();WiFi.disconnect(true);WiFi.mode(WIFI_OFF);cameraToken="";cameraServing=false;Serial.println("CAMERA_HTTP_STOPPED RADIO_OFF");}delay(100);}
}
