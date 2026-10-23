#pragma once
#include <Preferences.h>
// Separate NVS namespace; bounded metadata only, never images or credentials.
struct DurableNetworkEvent {NetworkEvent event;char boot[17];};
struct DurableNetworkHistory {uint32_t version,count;DurableNetworkEvent entries[48];};
static DurableNetworkHistory networkHistory={};
static uint32_t historyCursor=0,lastHistoryHeartbeat=0;
static bool historyWriteFailed=false,historyPreviousFailure=false;
static void loadNetworkHistory(){
 networkHistory.version=1;
 Preferences p;if(!p.begin("net-history",true))return;
 if(p.getBytesLength("ring")==sizeof(networkHistory))p.getBytes("ring",&networkHistory,sizeof(networkHistory));p.end();
 if(networkHistory.version!=1){memset(&networkHistory,0,sizeof(networkHistory));networkHistory.version=1;}
}
static void persistNetworkHistory(const String& boot){
 static NetworkEvent copy[128];uint32_t count;
 portENTER_CRITICAL(&networkEventLock);count=networkEventCount;memcpy(copy,networkEvents,sizeof(networkEvents));portEXIT_CRITICAL(&networkEventLock);
 bool changed=false;uint32_t first=count>128?count-128:0;if(historyCursor<first)historyCursor=first;
 for(;historyCursor<count;historyCursor++){
  auto &e=copy[historyCursor%128];bool failed=e.kind[0]=='u'&&e.code!=200;
  bool keep=e.kind[0]!='u'||failed||historyPreviousFailure||e.at-lastHistoryHeartbeat>=30000;
  if(e.kind[0]=='u'){historyPreviousFailure=failed;if(keep)lastHistoryHeartbeat=e.at;}
  if(!keep)continue;
  auto &dest=networkHistory.entries[networkHistory.count%48];dest.event=e;snprintf(dest.boot,sizeof(dest.boot),"%s",boot.c_str());networkHistory.count++;changed=true;
 }
 if(changed||historyWriteFailed){Preferences p;if(!p.begin("net-history",false)){historyWriteFailed=true;return;}historyWriteFailed=p.putBytes("ring",&networkHistory,sizeof(networkHistory))!=sizeof(networkHistory);p.end();}
}
static String networkHistoryJson(){
 String body="{\"bootId\":\"persistent-history\",\"capacity\":48,\"total\":"+String(networkHistory.count)+",\"uptimeMs\":"+String(millis())+",\"writeFailed\":"+(historyWriteFailed?"true":"false")+",\"events\":[";
 uint32_t first=networkHistory.count>48?networkHistory.count-48:0;
 for(uint32_t i=first;i<networkHistory.count;i++){
  auto &v=networkHistory.entries[i%48];auto &e=v.event;char row[380];
  snprintf(row,sizeof(row),"%s{\"bootId\":\"%s\",\"uptimeMs\":%lu,\"kind\":\"%s\",\"sequence\":%lu,\"durationMs\":%lu,\"code\":%d,\"rssi\":%d,\"channel\":%d,\"bssid\":\"%02x:%02x:%02x:%02x:%02x:%02x\"}",i==first?"":",",v.boot,(unsigned long)e.at,e.kind,(unsigned long)e.sequence,(unsigned long)e.duration,e.code,e.rssi,e.channel,e.bssid[0],e.bssid[1],e.bssid[2],e.bssid[3],e.bssid[4],e.bssid[5]);body+=row;
 }
 return body+"]}";
}
