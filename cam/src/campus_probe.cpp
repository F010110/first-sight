// Bounded open-network association probe: no credentials, images or login requests.
#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
void setup() {
  Serial.begin(115200); delay(1500);
  WiFi.persistent(false); WiFi.mode(WIFI_STA); WiFi.setAutoReconnect(false);
  Serial.println("CAMPUS_PROBE_START");
  WiFi.begin("BUPT-portal");
  unsigned long start=millis();
  while(WiFi.status()!=WL_CONNECTED && millis()-start<30000) delay(250);
  if(WiFi.status()==WL_CONNECTED) {
    Serial.printf("ASSOCIATED IP=%s GATEWAY=%s RSSI=%d CHANNEL=%d\n",WiFi.localIP().toString().c_str(),WiFi.gatewayIP().toString().c_str(),WiFi.RSSI(),WiFi.channel());
    HTTPClient request; request.setConnectTimeout(3000); request.setTimeout(3000);
    request.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
    const char* headers[]={"Location"}; request.collectHeaders(headers,1);
    if(request.begin("http://connectivitycheck.gstatic.com/generate_204")) {
      int code=request.GET();
      Serial.printf("HTTP_STATUS=%d REDIRECT_PRESENT=%d\n",code,request.header("Location").length()>0);
      // Do not print redirect queries/body: may contain identifiers or login challenges.
      request.end();
    }
  } else Serial.printf("ASSOCIATION_FAILED STATUS=%d\n",(int)WiFi.status());
  Serial.println("PROBE_DONE RADIO_OFF"); WiFi.disconnect(true); WiFi.mode(WIFI_OFF);
}
void loop() { delay(1000); }
