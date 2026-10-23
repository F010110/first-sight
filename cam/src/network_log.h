#pragma once
// Bounded RAM only. Wi-Fi callback and main loop share this ring.
struct NetworkEvent {uint32_t at,sequence,duration;int code,rssi,channel;uint8_t bssid[6];char kind[12];};
static NetworkEvent networkEvents[128];
static uint32_t networkEventCount=0;
static portMUX_TYPE networkEventLock=portMUX_INITIALIZER_UNLOCKED;
static void logNetwork(const char* kind,int code=0,uint32_t duration=0,uint32_t sequence=0,const uint8_t* address=nullptr){
 NetworkEvent e={};e.at=millis();e.sequence=sequence;e.duration=duration;e.code=code;e.rssi=WiFi.RSSI();e.channel=WiFi.channel();
 snprintf(e.kind,sizeof(e.kind),"%s",kind);if(!address)address=WiFi.BSSID();if(address)memcpy(e.bssid,address,6);
 portENTER_CRITICAL(&networkEventLock);networkEvents[networkEventCount%128]=e;networkEventCount++;portEXIT_CRITICAL(&networkEventLock);
}
static String networkLogJson(const String& boot){
 auto copy=new NetworkEvent[128];if(!copy)return "{}";uint32_t count;
 portENTER_CRITICAL(&networkEventLock);count=networkEventCount;memcpy(copy,networkEvents,sizeof(networkEvents));portEXIT_CRITICAL(&networkEventLock);
 String body="{\"bootId\":\""+boot+"\",\"capacity\":128,\"total\":"+String(count)+",\"uptimeMs\":"+String(millis())+",\"events\":[";
 uint32_t first=count>128?count-128:0;
 for(uint32_t i=first;i<count;i++){
  auto &e=copy[i%128];char row[320];
  snprintf(row,sizeof(row),"%s{\"uptimeMs\":%lu,\"kind\":\"%s\",\"sequence\":%lu,\"durationMs\":%lu,\"code\":%d,\"rssi\":%d,\"channel\":%d,\"bssid\":\"%02x:%02x:%02x:%02x:%02x:%02x\"}",i==first?"":",",(unsigned long)e.at,e.kind,(unsigned long)e.sequence,(unsigned long)e.duration,e.code,e.rssi,e.channel,e.bssid[0],e.bssid[1],e.bssid[2],e.bssid[3],e.bssid[4],e.bssid[5]);body+=row;
 }
 delete[] copy;return body+"]}";
}
