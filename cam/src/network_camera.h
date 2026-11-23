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
#ifndef FIRST_SIGHT_CAMERA_ROLE
#define FIRST_SIGHT_CAMERA_ROLE "unassigned"
#endif
static String cameraId,cameraRole;
static bool netStarted=false,authPending=false,authAttempted=false,portalOnline=false;
static uint32_t netSequence=0,lastAssociation=0,lastPortalCheck=0;
static String uplinkUrl;
static uint32_t nextUpload=0;
struct HotspotProfile {char ssid[33];char password[64];};
static HotspotProfile hotspotProfile={};
static bool hotspotMode=false;
static bool isPrivateHttpUrl(const String& url){
 if(!url.startsWith("http://")||url.length()>=180||url.indexOf(' ')>=0||url.indexOf('\t')>=0)return false;
 String hostPort=url.substring(7);
 int slash=hostPort.indexOf('/');
 if(slash>=0)hostPort=hostPort.substring(0,slash);
 int colon=hostPort.indexOf(':');
 if(colon>=0)hostPort=hostPort.substring(0,colon);
 IPAddress addr;
 if(!addr.fromString(hostPort))return false;
 return addr[0]==10||(addr[0]==172&&addr[1]>=16&&addr[1]<=31)||(addr[0]==192&&addr[1]==168);
}
static bool netAuthorized(){if(netServer.header("Authorization")=="Bearer "+deviceKey)return true;netServer.send(401,"text/plain","Pairing required");return false;}
static bool provideNetworkCredentials(String& user,String& password){Preferences prefs;prefs.begin("first-sight",true);user=prefs.getString("campus-user","");password=prefs.getString("campus-pass","");prefs.end();return user.length()>0&&password.length()>0;}
static void networkCameraSetup(){
 char identity[40];snprintf(identity,sizeof(identity),"first-sight-%012llx",(unsigned long long)ESP.getEfuseMac());cameraId=identity;
 cameraRole=FIRST_SIGHT_CAMERA_ROLE;
 Serial.printf("NETWORK_IDENTITY cameraId=%s direction=%s\n",cameraId.c_str(),cameraRole.c_str());
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
 uplinkUrl=prefs.getString("uplink","");
 memset(&hotspotProfile,0,sizeof(hotspotProfile));hotspotMode=false;
 if(prefs.getBytesLength("hs-wifi")==sizeof(hotspotProfile)){
  prefs.getBytes("hs-wifi",&hotspotProfile,sizeof(hotspotProfile));
  hotspotProfile.ssid[32]=0;hotspotProfile.password[63]=0;
  hotspotMode=strlen(hotspotProfile.ssid)>0&&strlen(hotspotProfile.password)>=8;
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
 WiFi.persistent(false);WiFi.mode(WIFI_STA);WiFi.setAutoReconnect(true);WiFi.setSleep(false);WiFi.setHostname(cameraId.c_str());
 WiFi.onEvent([](WiFiEvent_t event,WiFiEventInfo_t info){
  if(event==ARDUINO_EVENT_WIFI_STA_DISCONNECTED)Serial.printf("WIFI_DISCONNECTED reason=%u\n",(unsigned)info.wifi_sta_disconnected.reason);
  else if(event==ARDUINO_EVENT_WIFI_STA_CONNECTED)Serial.printf("WIFI_CONNECTED channel=%u\n",(unsigned)info.wifi_sta_connected.channel);
 });
 if(hotspotMode){Serial.println("WIFI_MODE=hotspot");WiFi.begin(hotspotProfile.ssid,hotspotProfile.password);}
 else{Serial.println("WIFI_MODE=campus");WiFi.begin("BUPT-portal");}
 lastAssociation=millis();
 portalCredentialSource=provideNetworkCredentials;
 const char* headers[]={"Authorization"};netServer.collectHeaders(headers,1);
 netServer.on("/v1/status",HTTP_GET,[]{if(!netAuthorized())return;netServer.send(200,"application/json",String("{\"device\":\"first-sight-cam\",\"cameraId\":\"")+cameraId+"\",\"direction\":\""+cameraRole+"\",\"identityVersion\":1,\"bootId\":\""+netBoot+"\",\"jpegQuality\":16,\"wifiMode\":\""+(hotspotMode?"hotspot":"campus")+"\",\"authAttempted\":"+(authAttempted?"true":"false")+",\"portalOnline\":"+(portalOnline?"true":"false")+"}");});
 netServer.on("/v1/frame",HTTP_GET,[]{
  if(!netAuthorized())return;
  for(int i=0;i<3;i++){auto old=esp_camera_fb_get();if(old)esp_camera_fb_return(old);delay(100);}
  auto frame=esp_camera_fb_get();if(!frame){netServer.send(503,"text/plain","Camera unavailable");return;}
  uint8_t digest[32];char hex[65];mbedtls_sha256_ret(frame->buf,frame->len,digest,0);for(int i=0;i<32;i++)snprintf(hex+i*2,3,"%02x",digest[i]);hex[64]=0;
  netServer.sendHeader("Cache-Control","no-store");netServer.sendHeader("Connection","close");
  netServer.sendHeader("X-Wifi-Rssi",String(WiFi.RSSI()));netServer.sendHeader("X-Wifi-Channel",String(WiFi.channel()));
  netServer.sendHeader("X-Camera-Id",cameraId);netServer.sendHeader("X-Camera-Direction",cameraRole);
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
 // Explicit USB-triggered connectivity probe and local Wi-Fi profile switching; never prints secrets.
 if(Serial.available()){
  String command=Serial.readStringUntil('\n');command.trim();
  if(command=="WIFI_HOTSPOT"){
   Serial.println("HOTSPOT_SECRETS_READY");Serial.setTimeout(10000);String ssid,password;
   bool valid=readSecret(ssid)&&readSecret(password)&&ssid.length()>0&&ssid.length()<=32&&password.length()>=8&&password.length()<=63;
   if(!valid){ssid="";password="";Serial.println("HOTSPOT_CONFIG_INVALID");return;}
   HotspotProfile profile={};memcpy(profile.ssid,ssid.c_str(),ssid.length());memcpy(profile.password,password.c_str(),password.length());
   ssid="";password="";
   Preferences p;bool saved=p.begin("first-sight",false);
   if(saved){p.remove("uplink");uplinkUrl="";saved=p.putBytes("hs-wifi",&profile,sizeof(profile))==sizeof(profile);p.end();}
   memset(&profile,0,sizeof(profile));
   Serial.println(saved?"HOTSPOT_CONFIGURED":"HOTSPOT_CONFIG_SAVE_FAILED");
   if(saved){delay(150);ESP.restart();}
   return;
  }
  if(command=="WIFI_CAMPUS"){
   Preferences p;if(p.begin("first-sight",false)){p.remove("hs-wifi");p.end();}
   Serial.println("CAMPUS_PROFILE_CONFIGURED");delay(150);ESP.restart();return;
  }
  if(command=="WIFI_STATUS"){
   Serial.printf("WIFI_STATUS mode=%s connected=%d ip=%s gw=%s rssi=%d ch=%d\n",
    hotspotMode?"hotspot":"campus",
    WiFi.status()==WL_CONNECTED?1:0,
    WiFi.localIP().toString().c_str(),
    WiFi.gatewayIP().toString().c_str(),
    WiFi.RSSI(),
    WiFi.channel());
  }
  if(command=="WIFI_SCAN"){
   int n=WiFi.scanNetworks(false,false,false,200);
   int targetFound=0,targetRssi=0,targetCh=0,targetAuth=-1;
   if(hotspotMode&&n>0){
    String expected=String(hotspotProfile.ssid);
    for(int i=0;i<n;i++){
     if(WiFi.SSID(i)==expected){targetFound=1;targetRssi=WiFi.RSSI(i);targetCh=WiFi.channel(i);targetAuth=(int)WiFi.encryptionType(i);break;}
    }
   }
   Serial.printf("WIFI_SCAN total=%d target_found=%d target_rssi=%d target_ch=%d target_auth=%d\n",n,targetFound,targetRssi,targetCh,targetAuth);
   WiFi.scanDelete();
  }
  if(command.startsWith("PROBE ")&&isPrivateHttpUrl(command.substring(6))){
   HTTPClient probe;probe.setConnectTimeout(3000);probe.setTimeout(3000);probe.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
   int status=-1;
   if(probe.begin(command.substring(6))){status=probe.GET();probe.end();}
   Serial.printf("UPLINK_PROBE_HTTP=%d\n",status);
  }
  if(command.startsWith("UPLINK http://10.122.")&&command.endsWith(":8885/v1/upload")&&command.length()<100){
   uplinkUrl=command.substring(7);Preferences prefs;prefs.begin("first-sight",false);prefs.putString("uplink",uplinkUrl);prefs.end();Serial.println("UPLINK_CONFIGURED");
  }
  if(command=="UPLINK_OFF"){uplinkUrl="";Preferences prefs;prefs.begin("first-sight",false);prefs.remove("uplink");prefs.end();Serial.println("UPLINK_DISABLED");}
 }
 if(deviceKey.length()!=64){delay(100);return;}
 if(WiFi.status()!=WL_CONNECTED){if(netStarted){netServer.stop();discovery.stop();MDNS.end();netStarted=false;authAttempted=false;}if(millis()-lastAssociation>30000){WiFi.reconnect();lastAssociation=millis();}delay(50);return;}
 if(!authAttempted||(!hotspotMode&&millis()-lastPortalCheck>600000)){authAttempted=true;lastPortalCheck=millis();portalOnline=hotspotMode?true:portalConnect(false);}
 if(!netStarted){
  netServer.begin();discovery.begin(33333);MDNS.begin(cameraId.c_str());MDNS.addService("http","tcp",80);netStarted=true;
  Serial.printf("NETWORK_CAMERA_READY IP=%s GW=%s RSSI=%d CH=%d\n",
   WiFi.localIP().toString().c_str(),WiFi.gatewayIP().toString().c_str(),WiFi.RSSI(),WiFi.channel());
 }
 if(discovery.parsePacket()){char query[64]={0};int n=discovery.read(query,63);if(n==21&&String(query)=="FIRST_SIGHT_DISCOVER_1"){discovery.beginPacket(discovery.remoteIP(),discovery.remotePort());discovery.print("FIRST_SIGHT_CAMERA_1");discovery.endPacket();}}
 netServer.handleClient();
 if(uplinkUrl.length()&&int32_t(millis()-nextUpload)>=0){
  for(int i=0;i<3;i++){auto old=esp_camera_fb_get();if(old)esp_camera_fb_return(old);delay(100);}
  auto frame=esp_camera_fb_get();int status=-1;
  if(frame){
   uint8_t digest[32];char hex[65];mbedtls_sha256_ret(frame->buf,frame->len,digest,0);for(int i=0;i<32;i++)snprintf(hex+i*2,3,"%02x",digest[i]);hex[64]=0;
   HTTPClient upload;upload.setConnectTimeout(3000);upload.setTimeout(8000);upload.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
   if(upload.begin(uplinkUrl)){
    upload.addHeader("Authorization","Bearer "+deviceKey);upload.addHeader("Content-Type","image/jpeg");upload.addHeader("X-Frame-Sha256",hex);
    upload.addHeader("X-Camera-Id",cameraId);upload.addHeader("X-Camera-Direction",cameraRole);
    upload.addHeader("X-Boot-Id",netBoot);upload.addHeader("X-Sequence",String(netSequence++));upload.addHeader("X-Jpeg-Quality","16");
    upload.addHeader("X-Capture-Ms",String(uint32_t(frame->timestamp.tv_sec*1000ULL+frame->timestamp.tv_usec/1000)));
    upload.addHeader("X-Wifi-Rssi",String(WiFi.RSSI()));upload.addHeader("X-Wifi-Channel",String(WiFi.channel()));
    status=upload.POST(frame->buf,frame->len);upload.end();
   }
   esp_camera_fb_return(frame);
  }
  Serial.printf("UPLINK_FRAME_HTTP=%d\n",status);nextUpload=millis()+(status==200?1700:3000);
 }
 delay(2);
}
