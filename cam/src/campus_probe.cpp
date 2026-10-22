// Bounded portal association and unauthenticated connectivity probe. No credentials.
#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
void setup() {
  Serial.begin(115200); delay(1500);
  WiFi.persistent(false); WiFi.mode(WIFI_STA); WiFi.setAutoReconnect(false);
  Serial.println("CAMPUS_PROBE_START");
  WiFi.begin("BUPT-portal");
  unsigned long start=millis();
  while(WiFi.status()!=WL_CONNECTED&&millis()-start<30000)delay(250);
  if(WiFi.status()==WL_CONNECTED){
    Serial.printf("PORTAL_ASSOCIATED IP=%s CHANNEL=%d\n",WiFi.localIP().toString().c_str(),WiFi.channel());
    String target="http://captive.apple.com/";
    for(int hop=0;hop<4;hop++){
    HTTPClient http;http.setConnectTimeout(3000);http.setTimeout(3000);
    http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
    const char* keys[]={"Location"};http.collectHeaders(keys,1);
    if(http.begin(target)){
      int status=http.GET();String location=http.header("Location");
      Serial.printf("APPLE_HTTP=%d REDIRECT_PRESENT=%d CAMPUS_AUTH_REDIRECT=%d\n",status,location.length()>0,location.startsWith("http://10.3.8.")||location.startsWith("https://10.3.8."));
      // Read at most 4096 bytes, never log portal body, cookies or redirect query.
      String body;auto stream=http.getStreamPtr();unsigned long deadline=millis()+3000;
      while(body.length()<4096&&millis()<deadline&&(http.connected()||stream->available())){
        if(stream->available())body+=(char)stream->read();else delay(10);
      }
      Serial.printf("APPLE_SUCCESS_MARKER=%d META_REFRESH=%d CAMPUS_AUTH_MARKER=%d\n",body.indexOf("<TITLE>Success</TITLE>")>=0&&body.indexOf("<BODY>Success</BODY>")>=0,body.indexOf("http-equiv")>=0,body.indexOf("10.3.8.")>=0);
      String next=location;
      if(next.length()==0){
        String lower=body;lower.toLowerCase();int pos=lower.indexOf("url=");
        if(pos>=0){pos+=4;while(pos<(int)body.length()&&(body[pos]==' '||body[pos]=='\''||body[pos]=='"'))pos++;
          int end=pos;while(end<(int)body.length()&&body[end]!='\''&&body[end]!='"'&&body[end]!='>'&&body[end]!='\r'&&body[end]!='\n')end++;
          next=body.substring(pos,end);next.trim();next.replace("&amp;","&");
        }
      }
      http.end();
      if(!(next.startsWith("http://")||next.startsWith("https://"))||next.length()>2048)break;
      int end=next.indexOf('/',next.indexOf("://")+3);if(end<0)end=next.length();
      int query=next.indexOf('?');if(query>=0&&query<end)end=query;
      Serial.printf("REDIRECT_HOP=%d ORIGIN=%s\n",hop+1,next.substring(0,end).c_str());
      target=next;
    }else break;
    }
  }else{
    Serial.printf("PORTAL_ASSOCIATION_FAILED STATUS=%d\n",(int)WiFi.status());
  }
  Serial.println("PROBE_DONE RADIO_OFF");WiFi.disconnect(true);WiFi.mode(WIFI_OFF);
}
void loop() { delay(1000); }
