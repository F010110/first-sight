#pragma once
#include "portal_session.h"
#include <WebServer.h>
#include <Preferences.h>
#include <ESPmDNS.h>
#include <WiFiUdp.h>
#include <mbedtls/sha256.h>
static WebServer netServer(80);
static WiFiUDP discovery;
static String deviceKey,netBoot,authUser,authPassword;
static bool netStarted=false,authPending=false,authAttempted=false,portalOnline=false;
static uint32_t netSequence=0,lastAssociation=0,lastPortalCheck=0;
static bool netAuthorized(){if(netServer.header("Authorization")=="Bearer "+deviceKey)return true;netServer.send(401,"text/plain","Pairing required");return false;}
static bool provideNetworkCredentials(String& user,String& password){Preferences prefs;prefs.begin("first-sight",true);user=prefs.getString("campus-user","");password=prefs.getString("campus-pass","");prefs.end();return user.length()>0&&password.length()>0;}
static void networkCameraSetup(){
 Preferences prefs;prefs.begin("first-sight",false);deviceKey=prefs.getString("pair-key","");
 if(deviceKey.length()!=64){
  Serial.println("NETWORK_PAIR_KEY_READY");Serial.setTimeout(120000);String value=Serial.readStringUntil('\n');value.trim();
  bool valid=value.length()==64;for(size_t i=0;i<value.length();i++)if(!isxdigit(value[i]))valid=false;
  if(!valid){prefs.end();Serial.println("NETWORK_PAIR_FAILED");return;}
  prefs.putString("pair-key",value);deviceKey=value;
 }
 if(!prefs.isKey("campus-user")||!prefs.isKey("campus-pass")){
  Serial.println("NETWORK_CAMPUS_CREDENTIALS_READY");Serial.setTimeout(120000);String user,password;
  if(!readSecret(user)||!readSecret(password)){prefs.end();Serial.println("NETWORK_CREDENTIALS_INVALID");deviceKey="";return;}
  prefs.putString("campus-user",user);prefs.putString("campus-pass",password);user="";password="";
 }
 prefs.end();Serial.println("NETWORK_PAIRED");
 netBoot=String(esp_random(),HEX)+String(esp_random(),HEX);
 esp_camera_sensor_get()->set_quality(esp_camera_sensor_get(),16);
 // Modest low-light profile; preserve automatic adaptation, avoid fixed long exposure.
 auto sensor=esp_camera_sensor_get();
 sensor->set_exposure_ctrl(sensor,1);sensor->set_gain_ctrl(sensor,1);
 sensor->set_aec2(sensor,1);sensor->set_ae_level(sensor,1);
 sensor->set_gainceiling(sensor,GAINCEILING_16X);
 sensor->set_brightness(sensor,1);
 WiFi.persistent(false);WiFi.mode(WIFI_STA);WiFi.setAutoReconnect(true);WiFi.setSleep(false);WiFi.setHostname("first-sight-cam");WiFi.begin("BUPT-portal");lastAssociation=millis();
 portalCredentialSource=provideNetworkCredentials;
 const char* headers[]={"Authorization"};netServer.collectHeaders(headers,1);
 netServer.on("/v1/status",HTTP_GET,[]{if(!netAuthorized())return;netServer.send(200,"application/json",String("{\"device\":\"first-sight-cam\",\"bootId\":\"")+netBoot+"\",\"jpegQuality\":16,\"authAttempted\":"+(authAttempted?"true":"false")+",\"portalOnline\":"+(portalOnline?"true":"false")+"}");});
 netServer.on("/v1/frame",HTTP_GET,[]{
  if(!netAuthorized())return;
  for(int i=0;i<3;i++){auto old=esp_camera_fb_get();if(old)esp_camera_fb_return(old);delay(100);}
  auto frame=esp_camera_fb_get();if(!frame){netServer.send(503,"text/plain","Camera unavailable");return;}
  uint8_t digest[32];char hex[65];mbedtls_sha256_ret(frame->buf,frame->len,digest,0);for(int i=0;i<32;i++)snprintf(hex+i*2,3,"%02x",digest[i]);hex[64]=0;
  netServer.sendHeader("Cache-Control","no-store");netServer.sendHeader("Connection","close");
  netServer.sendHeader("X-Wifi-Rssi",String(WiFi.RSSI()));netServer.sendHeader("X-Wifi-Channel",String(WiFi.channel()));
  netServer.sendHeader("X-Frame-Sha256",hex);netServer.sendHeader("X-Boot-Id",netBoot);netServer.sendHeader("X-Sequence",String(netSequence++));netServer.sendHeader("X-Jpeg-Quality","16");
  netServer.sendHeader("X-Capture-Ms",String(uint32_t(frame->timestamp.tv_sec*1000ULL+frame->timestamp.tv_usec/1000)));
  netServer.setContentLength(frame->len);netServer.send(200,"image/jpeg","");
  auto client=netServer.client();client.setNoDelay(true);client.setTimeout(5);
  size_t sent=0;uint32_t started=millis();while(sent<frame->len&&client.connected()&&millis()-started<20000){size_t remaining=frame->len-sent;size_t n=client.write(frame->buf+sent,remaining>1460?1460:remaining);if(!n)break;sent+=n;delay(2);}
  Serial.printf("NETWORK_FRAME sequence=%u bytes=%u sent=%u\n",netSequence-1,frame->len,sent);
  esp_camera_fb_return(frame);client.stop();
 });
 netServer.onNotFound([]{netServer.send(404,"text/plain","Not found");});
}
static void networkCameraLoop(){
 if(deviceKey.length()!=64){delay(100);return;}
 if(WiFi.status()!=WL_CONNECTED){if(netStarted){netServer.stop();discovery.stop();MDNS.end();netStarted=false;authAttempted=false;}if(millis()-lastAssociation>30000){WiFi.reconnect();lastAssociation=millis();}delay(50);return;}
 if(!authAttempted||millis()-lastPortalCheck>600000){authAttempted=true;lastPortalCheck=millis();portalOnline=portalConnect(false);}
 if(!netStarted){netServer.begin();discovery.begin(33333);MDNS.begin("first-sight-cam");MDNS.addService("http","tcp",80);netStarted=true;Serial.printf("NETWORK_CAMERA_READY IP=%s\n",WiFi.localIP().toString().c_str());}
 if(discovery.parsePacket()){char query[64]={0};int n=discovery.read(query,63);if(n==21&&String(query)=="FIRST_SIGHT_DISCOVER_1"){discovery.beginPacket(discovery.remoteIP(),discovery.remotePort());discovery.print("FIRST_SIGHT_CAMERA_1");discovery.endPacket();}}
 netServer.handleClient();
 delay(2);
}
