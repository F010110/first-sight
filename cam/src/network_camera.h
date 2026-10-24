#pragma once
#include "portal_session.h"
#include <WebServer.h>
#include <Preferences.h>
#include <ESPmDNS.h>
#include <WiFiUdp.h>
#include <mbedtls/sha256.h>
#include "network_log.h"
#include "network_history.h"
static WebServer netServer(80);
static WiFiUDP discovery;
static String deviceKey,netBoot,authUser,authPassword;
static bool netStarted=false,authPending=false,authAttempted=false,portalOnline=false;
static uint32_t netSequence=0,lastAssociation=0,lastPortalCheck=0;
static String uplinkUrl;
static uint32_t nextUpload=0;
static uint32_t lastDiagnosticUpload=0;
static bool uploadRecoveryPending=false;
struct HotspotProfile {char ssid[33];char password[64];};
static HotspotProfile hotspotProfile={};
static bool hotspotMode=false;
static bool privateUploadUrl(const String& value){
 const String prefix="http://",suffix=":8885/v1/upload";
 if(!value.startsWith(prefix)||!value.endsWith(suffix)||value.length()>100)return false;
 IPAddress address;if(!address.fromString(value.substring(prefix.length(),value.length()-suffix.length())))return false;
 return address[0]==10||(address[0]==172&&address[1]>=16&&address[1]<=31)||(address[0]==192&&address[1]==168);
}
static String activeUplink(){return uplinkUrl=="hotspot-gateway"?"http://"+WiFi.gatewayIP().toString()+":8885/v1/upload":uplinkUrl;}
static bool netAuthorized(){if(netServer.header("Authorization")=="Bearer "+deviceKey)return true;netServer.send(401,"text/plain","Pairing required");return false;}
static bool provideNetworkCredentials(String& user,String& password){Preferences prefs;prefs.begin("first-sight",true);user=prefs.getString("campus-user","");password=prefs.getString("campus-pass","");prefs.end();return user.length()>0&&password.length()>0;}
static void networkCameraSetup(){
 loadNetworkHistory();
 WiFi.onEvent([](WiFiEvent_t event,WiFiEventInfo_t info){
  if(event==ARDUINO_EVENT_WIFI_STA_DISCONNECTED)logNetwork("disconnect",info.wifi_sta_disconnected.reason,0,0,info.wifi_sta_disconnected.bssid);
  else if(event==ARDUINO_EVENT_WIFI_STA_CONNECTED)logNetwork("associated",0,0,0,info.wifi_sta_connected.bssid);
  else if(event==ARDUINO_EVENT_WIFI_STA_GOT_IP)logNetwork("got-ip");
 });
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
 if(prefs.getBytesLength("phone-wifi")==sizeof(hotspotProfile)){
  prefs.getBytes("phone-wifi",&hotspotProfile,sizeof(hotspotProfile));hotspotProfile.ssid[32]=0;hotspotProfile.password[63]=0;
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
 WiFi.persistent(false);WiFi.mode(WIFI_STA);WiFi.setAutoReconnect(true);WiFi.setSleep(false);WiFi.setHostname("first-sight-cam");
 if(hotspotMode)WiFi.begin(hotspotProfile.ssid,hotspotProfile.password);else WiFi.begin("BUPT-portal");lastAssociation=millis();
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
 netServer.on("/v1/network-log",HTTP_GET,[]{if(!netAuthorized())return;netServer.sendHeader("Cache-Control","no-store");netServer.send(200,"application/json",networkLogJson(netBoot));});
 netServer.on("/v1/network-history",HTTP_GET,[]{if(!netAuthorized())return;netServer.sendHeader("Cache-Control","no-store");netServer.send(200,"application/json",networkHistoryJson());});
 netServer.onNotFound([]{netServer.send(404,"text/plain","Not found");});
}
static void networkCameraLoop(){
 persistNetworkHistory(netBoot);
 // Explicit USB-triggered connectivity probe; never sends images or credentials.
 if(Serial.available()){
  String command=Serial.readStringUntil('\n');command.trim();
   if(command=="NETWORK_HISTORY")Serial.println(networkHistoryJson());
  if(command=="WIFI_HOTSPOT"){
   Serial.println("HOTSPOT_SECRETS_READY");Serial.setTimeout(10000);String ssid,password;
   bool valid=readSecret(ssid)&&readSecret(password)&&ssid.length()>0&&ssid.length()<=32&&password.length()>=8&&password.length()<=63;
   if(!valid){Serial.println("HOTSPOT_CONFIG_INVALID");return;}
   HotspotProfile profile={};memcpy(profile.ssid,ssid.c_str(),ssid.length());memcpy(profile.password,password.c_str(),password.length());ssid="";password="";
   Preferences p;bool saved=p.begin("first-sight",false);
   if(saved){saved=p.putString("uplink","hotspot-gateway")>0&&p.putBytes("phone-wifi",&profile,sizeof(profile))==sizeof(profile);p.end();}
   memset(&profile,0,sizeof(profile));Serial.println(saved?"HOTSPOT_CONFIGURED":"HOTSPOT_CONFIG_SAVE_FAILED");
   if(saved){delay(150);ESP.restart();}return;
  }
  if(command=="WIFI_CAMPUS"){
   Preferences p;p.begin("first-sight",false);p.remove("phone-wifi");p.end();Serial.println("CAMPUS_PROFILE_CONFIGURED");delay(150);ESP.restart();return;
  }
  if(command.startsWith("PROBE http://10.122.")&&command.length()<180){
   HTTPClient probe;probe.setConnectTimeout(3000);probe.setTimeout(3000);probe.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
   if(probe.begin(command.substring(6))){int status=probe.GET();Serial.printf("UPLINK_PROBE_HTTP=%d\n",status);probe.end();}
  }
  if(command.startsWith("UPLINK ")&&privateUploadUrl(command.substring(7))){
   uplinkUrl=command.substring(7);Preferences prefs;prefs.begin("first-sight",false);prefs.putString("uplink",uplinkUrl);prefs.end();Serial.println("UPLINK_CONFIGURED");
  }
  if(command=="UPLINK_OFF"){uplinkUrl="";Preferences prefs;prefs.begin("first-sight",false);prefs.remove("uplink");prefs.end();Serial.println("UPLINK_DISABLED");}
 }
 if(deviceKey.length()!=64){delay(100);return;}
 if(WiFi.status()!=WL_CONNECTED){if(netStarted){netServer.stop();discovery.stop();MDNS.end();netStarted=false;authAttempted=false;}if(millis()-lastAssociation>30000){WiFi.reconnect();lastAssociation=millis();}delay(50);return;}
 if(!authAttempted||millis()-lastPortalCheck>600000){authAttempted=true;lastPortalCheck=millis();portalOnline=hotspotMode?true:portalConnect(false);}
 if(!netStarted){netServer.begin();discovery.begin(33333);MDNS.begin("first-sight-cam");MDNS.addService("http","tcp",80);netStarted=true;Serial.printf("NETWORK_CAMERA_READY IP=%s\n",WiFi.localIP().toString().c_str());}
 if(discovery.parsePacket()){char query[64]={0};int n=discovery.read(query,63);if(n==21&&String(query)=="FIRST_SIGHT_DISCOVER_1"){discovery.beginPacket(discovery.remoteIP(),discovery.remotePort());discovery.print("FIRST_SIGHT_CAMERA_1");discovery.endPacket();}}
  netServer.handleClient();
 if(uplinkUrl.length()&&int32_t(millis()-nextUpload)>=0){
  uint32_t uploadStart=millis(),uploadSequence=netSequence;
  for(int i=0;i<3;i++){auto old=esp_camera_fb_get();if(old)esp_camera_fb_return(old);delay(100);}
  auto frame=esp_camera_fb_get();int status=-1001;
  if(frame){
   uint8_t digest[32];char hex[65];mbedtls_sha256_ret(frame->buf,frame->len,digest,0);for(int i=0;i<32;i++)snprintf(hex+i*2,3,"%02x",digest[i]);hex[64]=0;
   HTTPClient upload;upload.setConnectTimeout(3000);upload.setTimeout(8000);upload.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
   status=-1002;
   if(upload.begin(activeUplink())){
    upload.addHeader("Authorization","Bearer "+deviceKey);upload.addHeader("Content-Type","image/jpeg");upload.addHeader("X-Frame-Sha256",hex);
    upload.addHeader("X-Boot-Id",netBoot);upload.addHeader("X-Sequence",String(netSequence++));upload.addHeader("X-Jpeg-Quality","16");
    upload.addHeader("X-Capture-Ms",String(uint32_t(frame->timestamp.tv_sec*1000ULL+frame->timestamp.tv_usec/1000)));
    upload.addHeader("X-Wifi-Rssi",String(WiFi.RSSI()));upload.addHeader("X-Wifi-Channel",String(WiFi.channel()));
    status=upload.POST(frame->buf,frame->len);upload.end();
   }
   esp_camera_fb_return(frame);
  }
  logNetwork("upload",status,millis()-uploadStart,uploadSequence);
  persistNetworkHistory(netBoot);
  if(status!=200)uploadRecoveryPending=true;
  if(status==200&&(uploadRecoveryPending||millis()-lastDiagnosticUpload>=30000)){
   String endpoint=activeUplink();endpoint.replace("/v1/upload","/v1/network-log");
   HTTPClient diagnostic;diagnostic.setConnectTimeout(1500);diagnostic.setTimeout(2000);diagnostic.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
   if(diagnostic.begin(endpoint)){
    diagnostic.addHeader("Authorization","Bearer "+deviceKey);diagnostic.addHeader("Content-Type","application/json");
    int result=diagnostic.POST(networkHistoryJson());diagnostic.end();
    if(result==200){lastDiagnosticUpload=millis();uploadRecoveryPending=false;}
   }
  }
  Serial.printf("UPLINK_FRAME_HTTP=%d\n",status);nextUpload=millis()+(status==200?1700:3000);
 }
 delay(2);
}
