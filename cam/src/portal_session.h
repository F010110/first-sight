#pragma once
// Bounded portal login. Credentials arrive over USB only after endpoint validation.
#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
static CookieJar cookies;
// Optional network provisioning source; campus credentials remain in RAM only.
static bool (*portalCredentialSource)(String&,String&)=nullptr;
static String boundedBody(HTTPClient& http){
  String body;auto stream=http.getStreamPtr();unsigned long start=millis();
  while(body.length()<8192&&millis()-start<4000&&(http.connected()||stream->available())){
    if(stream->available())body+=(char)stream->read();else delay(10);
  }return body;
}
static String urlEncode(const String& value){
  String out;const char* hex="0123456789ABCDEF";
  for(size_t i=0;i<value.length();i++){uint8_t c=value[i];if(isalnum(c)||c=='-'||c=='_'||c=='.'||c=='~')out+=(char)c;else{out+='%';out+=hex[c>>4];out+=hex[c&15];}}return out;
}
static bool readSecret(String& out){
  String line=Serial.readStringUntil('\n');line.trim();
  if(line.length()==0||line.length()>2048||line.length()%2)return false;
  for(size_t i=0;i<line.length();i+=2){
    char a=line[i],b=line[i+1];if(!isxdigit(a)||!isxdigit(b))return false;
    auto digit=[](char c){return c<='9'?c-'0':tolower(c)-'a'+10;};
    char c=(digit(a)<<4)|digit(b);if(c==0)return false;out+=c;
  }return true;
}
static bool loginOnce(const String& target){
  // No arbitrary redirect destination may receive secrets. Keep full AC query in RAM only.
  const String prefix="http://10.3.8.216/index";
  if(target!=prefix&&!target.startsWith(prefix+"?")){Serial.println("AUTH_ENDPOINT_REJECTED");return false;}
  String user,password;
  if(portalCredentialSource){if(!portalCredentialSource(user,password))return false;}
  else{Serial.println("AUTH_READY_USB_SECRETS");Serial.setTimeout(60000);if(!readSecret(user)||!readSecret(password)){Serial.println("AUTH_INPUT_INVALID");return false;}}
  String endpoint="http://10.3.8.216/login"+target.substring(prefix.length());
  HTTPClient post;post.setCookieJar(&cookies);post.setConnectTimeout(3000);post.setTimeout(5000);
  post.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
  if(!post.begin(endpoint))return false;
  post.addHeader("Content-Type","application/x-www-form-urlencoded");
  String payload="user="+urlEncode(user)+"&pass="+urlEncode(password);
  int code=post.POST(payload);Serial.printf("AUTH_POST_HTTP=%d\n",code);
  payload="";user="";password="";post.end();
  HTTPClient check;check.setConnectTimeout(3000);check.setTimeout(5000);
  if(!check.begin("http://captive.apple.com/"))return false;
  int status=check.GET();String body=boundedBody(check);check.end();body.toLowerCase();
  bool success=status==200&&body.indexOf("<title>success</title>")>=0&&body.indexOf("<body>success</body>")>=0;
  Serial.printf("POST_LOGIN_HTTP=%d INTERNET_CHECK_SUCCESS=%d\n",status,success);return success;
}
static bool portalConnect(bool associate=true) {
  bool online=false;
  if(associate){WiFi.persistent(false); WiFi.mode(WIFI_STA); WiFi.setAutoReconnect(false);}
  Serial.println("CAMPUS_PROBE_START");
  if(associate)WiFi.begin("BUPT-portal");
  unsigned long start=millis();
  while(WiFi.status()!=WL_CONNECTED&&millis()-start<30000)delay(250);
  if(WiFi.status()==WL_CONNECTED){
    Serial.printf("PORTAL_ASSOCIATED IP=%s CHANNEL=%d\n",WiFi.localIP().toString().c_str(),WiFi.channel());
    String target="http://captive.apple.com/";
    for(int hop=0;hop<4;hop++){
    HTTPClient http;http.setConnectTimeout(3000);http.setTimeout(3000);
    http.setCookieJar(&cookies);
    http.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
    const char* keys[]={"Location"};http.collectHeaders(keys,1);
    if(http.begin(target)){
      int status=http.GET();String location=http.header("Location");
      Serial.printf("APPLE_HTTP=%d REDIRECT_PRESENT=%d CAMPUS_AUTH_REDIRECT=%d\n",status,location.length()>0,location.startsWith("http://10.3.8.")||location.startsWith("https://10.3.8."));
      // Read at most 4096 bytes, never log portal body, cookies or redirect query.
      String body=boundedBody(http);
      String lowerBody=body;lowerBody.toLowerCase();
      if(status==200&&lowerBody.indexOf("<title>success</title>")>=0&&lowerBody.indexOf("<body>success</body>")>=0){online=true;http.end();break;}
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
      if(target=="http://10.3.8.216/index"||target.startsWith("http://10.3.8.216/index?")){
        if(status==200)online=loginOnce(target);else Serial.println("AUTH_PAGE_UNAVAILABLE");
        break;
      }
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
  return online;
}
