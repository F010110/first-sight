#pragma once
#include "portal_session.h"
#include <mbedtls/sha256.h>
static WiFiServer imageServer(80);
static WiFiClient imageClient;
static String imageToken,imageBoot;
static uint32_t imageSequence=0,imageStarted=0;
static bool imageServing=false;
static int imageQuality=12;
static bool readHeaderLine(String& line,uint32_t start){
  while(imageClient.connected()&&millis()-start<2000){
    if(imageClient.available()){char c=imageClient.read();if(c=='\n')return true;if(line.length()>=1024)return false;line+=c;}
    else delay(1);
  }return false;
}
static bool writeAll(const uint8_t* data,size_t size){
  size_t sent=0;uint32_t start=millis();
  while(sent<size&&imageClient.connected()&&millis()-start<8000){
    size_t count=size-sent;
#ifdef FIRST_SIGHT_PACED_WRITES
    if(count>1460)count=1460;
#endif
    size_t n=imageClient.write(data+sent,count);if(!n)return false;sent+=n;
#ifdef FIRST_SIGHT_PACED_WRITES
    delay(2);
#endif
  }
  return sent==size;
}
static void portalCameraSetup(){
  if(!portalConnect()){Serial.println("CAMERA_NETWORK_FAILED");WiFi.mode(WIFI_OFF);return;}
  WiFi.setSleep(false);Serial.println("CAMERA_WIFI_SLEEP_DISABLED");
  Serial.println("CAMERA_JPEG_CONFIG_READY");Serial.setTimeout(60000);
  String quality=Serial.readStringUntil('\n');quality.trim();
  if(quality!="12"&&quality!="16"){Serial.println("CAMERA_JPEG_CONFIG_INVALID");WiFi.mode(WIFI_OFF);return;}
  imageQuality=quality.toInt();
  if(esp_camera_sensor_get()->set_quality(esp_camera_sensor_get(),imageQuality)!=0){Serial.println("CAMERA_JPEG_CONFIG_FAILED");WiFi.mode(WIFI_OFF);return;}
  Serial.printf("CAMERA_JPEG_QUALITY=%d\n",imageQuality);
  Serial.println("CAMERA_TOKEN_READY");Serial.setTimeout(60000);imageToken=Serial.readStringUntil('\n');imageToken.trim();
  if(imageToken.length()!=64){WiFi.mode(WIFI_OFF);return;}
  for(size_t i=0;i<imageToken.length();i++)if(!isxdigit(imageToken[i])){WiFi.mode(WIFI_OFF);return;}
  imageBoot=String(esp_random(),HEX)+String(esp_random(),HEX);
  imageServer.begin();imageServer.setNoDelay(true);imageStarted=millis();imageServing=true;
  Serial.printf("CAMERA_HTTP_READY IP=%s PORT=80 TTL_SECONDS=180\n",WiFi.localIP().toString().c_str());
}
static void portalCameraLoop(){
  if(!imageServing){delay(100);return;}
  if(millis()-imageStarted>=180000){imageClient.stop();imageServer.end();WiFi.disconnect(true);WiFi.mode(WIFI_OFF);imageToken="";imageServing=false;Serial.println("CAMERA_HTTP_STOPPED RADIO_OFF");return;}
  if(!imageClient.connected()){imageClient=imageServer.available();if(imageClient){imageClient.setNoDelay(true);imageClient.setTimeout(1000);}else{delay(2);return;}}
  if(!imageClient.available()){delay(2);return;}
  // Minimal, bounded HTTP GET parser. No body, other routes, pipelining or uploads.
  uint32_t start=millis();String request;
  if(!readHeaderLine(request,start)){imageClient.stop();return;}
  bool authorized=false,ended=false;
  size_t bytes=request.length();
  for(int line=0;line<24&&bytes<4096&&millis()-start<2000;line++){
    String header;if(!readHeaderLine(header,start)){imageClient.stop();return;}bytes+=header.length();header.trim();
    if(header.length()==0){ended=true;break;}
    if(header=="Authorization: Bearer "+imageToken)authorized=true;
  }
  if(!ended||bytes>=4096||!authorized||request!="GET /v1/frame HTTP/1.1\r"){
    imageClient.print("HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");imageClient.stop();return;
  }
  uint32_t prepare=micros();
  for(int i=0;i<3;i++){auto old=esp_camera_fb_get();if(old)esp_camera_fb_return(old);delay(100);}
  auto frame=esp_camera_fb_get();if(!frame){imageClient.stop();return;}
  uint8_t digest[32];char hex[65];
  if(mbedtls_sha256_ret(frame->buf,frame->len,digest,0)!=0){esp_camera_fb_return(frame);imageClient.stop();return;}
  for(int i=0;i<32;i++)snprintf(hex+i*2,3,"%02x",digest[i]);hex[64]=0;
  String headers="HTTP/1.1 200 OK\r\nContent-Type: image/jpeg\r\nConnection: keep-alive\r\nCache-Control: no-store\r\nContent-Length: "+String(frame->len)+"\r\nX-Frame-Sha256: "+hex+"\r\nX-Boot-Id: "+imageBoot+"\r\nX-Sequence: "+String(imageSequence++)+"\r\nX-Jpeg-Quality: "+String(imageQuality)+"\r\nX-Capture-Ms: "+String(uint32_t(frame->timestamp.tv_sec*1000ULL+frame->timestamp.tv_usec/1000))+"\r\nX-Prepare-Us: "+String(uint32_t(micros()-prepare))+"\r\n\r\n";
  bool ok=writeAll((const uint8_t*)headers.c_str(),headers.length())&&writeAll(frame->buf,frame->len);
  esp_camera_fb_return(frame);if(!ok)imageClient.stop();
}
