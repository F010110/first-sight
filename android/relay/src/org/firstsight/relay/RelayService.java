package org.firstsight.relay;

import android.app.*;
import android.content.Intent;
import android.os.*;
import android.graphics.BitmapFactory;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;

public class RelayService extends Service {
 private volatile boolean running;private ServerSocket server;private PowerManager.WakeLock wake;
 private String destination,token;private volatile long received,forwarded,dropped;private Thread receiver,sender;
 private final AtomicReference<Packet> latest=new AtomicReference<>(),diagnostic=new AtomicReference<>();
 private static final String[] FRAME_HEADERS={"X-Frame-Sha256","X-Boot-Id","X-Sequence","X-Capture-Ms","X-Jpeg-Quality","X-Wifi-Rssi","X-Wifi-Channel"};
 private static class Packet {String path;Map<String,String> headers;byte[] bytes;long elapsed,wall;}
 public static void validateDestination(String value)throws Exception{
  URI uri=new URI(value);if(!"http".equals(uri.getScheme())||uri.getUserInfo()!=null||uri.getQuery()!=null||uri.getFragment()!=null||!(uri.getPath().isEmpty()||uri.getPath().equals(""))||uri.getPort()!=8885)throw new Exception("请填写 http://电脑私有IPv4:8885，不含路径");
  String host=uri.getHost();if(host==null||!host.matches("[0-9.]+"))throw new Exception("电脑地址必须为私有IPv4");
  InetAddress address=InetAddress.getByName(host);if(!address.isSiteLocalAddress()||address.isLoopbackAddress())throw new Exception("仅允许局域网地址");
 }
 public IBinder onBind(Intent intent){return null;}
 public int onStartCommand(Intent intent,int flags,int startId){if(running)return START_NOT_STICKY;
  try{destination=getSharedPreferences("relay",0).getString("host","");token=getSharedPreferences("relay",0).getString("token","");validateDestination(destination);if(!token.matches("[a-fA-F0-9]{64}"))throw new Exception("Missing token");
   NotificationManager manager=getSystemService(NotificationManager.class);manager.createNotificationChannel(new NotificationChannel("relay","摄像头中继",NotificationManager.IMPORTANCE_LOW));
   PendingIntent open=PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_IMMUTABLE);
   startForeground(1,new Notification.Builder(this,"relay").setContentTitle("First Sight 中继运行中").setContentText("仅转发，不缓存图像；点击查看两段连接状态").setSmallIcon(android.R.drawable.stat_sys_upload).setContentIntent(open).build());
   wake=((PowerManager)getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"FirstSight:relay");wake.acquire();
   server=new ServerSocket();server.setReuseAddress(true);server.bind(new InetSocketAddress(8885),4);running=true;
   Packet probe=new Packet();probe.path="/v1/network-log";probe.headers=new TreeMap<>(String.CASE_INSENSITIVE_ORDER);probe.headers.put("X-Boot-Id","android-relay-probe");probe.elapsed=SystemClock.elapsedRealtime();probe.wall=System.currentTimeMillis();probe.bytes="{\"bootId\":\"android-relay-probe\",\"capacity\":0,\"total\":0,\"uptimeMs\":0,\"events\":[]}".getBytes("UTF-8");diagnostic.set(probe);
   receiver=new Thread(this::receive,"camera-receiver");sender=new Thread(this::send,"computer-uplink");receiver.start();sender.start();log("started",null,0);
  }catch(Exception error){status("启动失败："+error.getClass().getSimpleName());stopSelf();}
  return START_NOT_STICKY;
 }
 private void receive(){while(running){try(Socket socket=server.accept()){
   socket.setSoTimeout(8000);InputStream input=new BufferedInputStream(socket.getInputStream());long deadline=SystemClock.elapsedRealtime()+12000;
   String line=readLine(input,deadline);String[] parts=line.split(" ");if(parts.length!=3||!parts[0].equals("POST")||!Arrays.asList("/v1/upload","/v1/network-log").contains(parts[1])){reply(socket,404);continue;}
   Map<String,String> headers=new TreeMap<>(String.CASE_INSENSITIVE_ORDER);int size=line.length();
   while(!(line=readLine(input,deadline)).isEmpty()){size+=line.length();if(size>8192)throw new IOException("headers");int colon=line.indexOf(':');if(colon<1)throw new IOException("header");String name=line.substring(0,colon).trim();if(headers.containsKey(name))throw new IOException("duplicate header");headers.put(name,line.substring(colon+1).trim());}
   if(!MessageDigest.isEqual(("Bearer "+token).getBytes("UTF-8"),headers.getOrDefault("Authorization","").getBytes("UTF-8"))){reply(socket,401);continue;}
   int length=Integer.parseInt(headers.getOrDefault("Content-Length","-1"));boolean image=parts[1].equals("/v1/upload");if(headers.containsKey("Transfer-Encoding")||length<=0||length>(image?300000:65536)){reply(socket,400);continue;}
   Packet p=new Packet();p.path=parts[1];p.headers=headers;p.elapsed=SystemClock.elapsedRealtime();p.wall=System.currentTimeMillis();p.bytes=new byte[length];int offset=0;
   while(offset<length){if(SystemClock.elapsedRealtime()>deadline)throw new IOException("body deadline");int n=input.read(p.bytes,offset,length-offset);if(n<0)throw new EOFException();offset+=n;}
   if(image){if(!"image/jpeg".equals(headers.get("Content-Type")))throw new IOException("type");StringBuilder hex=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(p.bytes))hex.append(String.format(Locale.US,"%02x",b&255));if(!hex.toString().equals(headers.get("X-Frame-Sha256")))throw new IOException("hash");
    BitmapFactory.Options options=new BitmapFactory.Options();options.inJustDecodeBounds=true;BitmapFactory.decodeByteArray(p.bytes,0,length,options);if(options.outWidth!=640||options.outHeight!=480)throw new IOException("dimensions");
    received++;if(latest.getAndSet(p)!=null){dropped++;log("replaced-pending",p,0);}log("phone-received",p,200);
   }else{new JSONObject(new String(p.bytes,"UTF-8"));diagnostic.set(p);log("phone-diagnostic",p,200);}
   // Acknowledges RAM acceptance only, not desktop persistence.
   reply(socket,200);
  }catch(Exception error){if(running){log("receive-"+error.getClass().getSimpleName(),null,0);status("摄像头接收错误："+error.getClass().getSimpleName());}}}}
 private void send(){while(running){Packet p=latest.getAndSet(null);if(p==null)p=diagnostic.getAndSet(null);if(p==null){try{Thread.sleep(100);}catch(InterruptedException ignored){}continue;}
  if(p.path.equals("/v1/upload")&&SystemClock.elapsedRealtime()-p.elapsed>8000){dropped++;log("stale-dropped",p,0);continue;}
  HttpURLConnection connection=null;long started=SystemClock.elapsedRealtime();try{
   connection=(HttpURLConnection)new URL(destination+p.path).openConnection();connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(3000);connection.setReadTimeout(8000);connection.setRequestMethod("POST");connection.setDoOutput(true);connection.setFixedLengthStreamingMode(p.bytes.length);connection.setRequestProperty("Authorization","Bearer "+token);connection.setRequestProperty("Content-Type",p.path.equals("/v1/upload")?"image/jpeg":"application/json");
   if(p.path.equals("/v1/upload"))for(String header:FRAME_HEADERS){String value=p.headers.get(header);if(value!=null)connection.setRequestProperty(header,value);}
   connection.setRequestProperty("X-Relay-Received-Wall-Ms",String.valueOf(p.wall));try(OutputStream output=connection.getOutputStream()){output.write(p.bytes);}int code=connection.getResponseCode();if(code==200){if(p.path.equals("/v1/upload"))forwarded++;}else dropped++;log("computer-response",p,code);status("电脑返回 "+code+" · 转发耗时 "+(SystemClock.elapsedRealtime()-started)+"ms");
  }catch(Exception error){dropped++;log("forward-"+error.getClass().getSimpleName(),p,0);status("电脑转发失败："+error.getClass().getSimpleName());}finally{if(connection!=null)connection.disconnect();}
 }}
 private static String readLine(InputStream input,long deadline)throws IOException{ByteArrayOutputStream bytes=new ByteArrayOutputStream();while(bytes.size()<8192){if(SystemClock.elapsedRealtime()>deadline)throw new IOException("header deadline");int b=input.read();if(b<0)throw new EOFException();if(b==10)return bytes.toString("US-ASCII").replace("\r","");bytes.write(b);}throw new IOException("line too long");}
 private static void reply(Socket socket,int code)throws IOException{socket.getOutputStream().write(("HTTP/1.1 "+code+" Result\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK").getBytes("US-ASCII"));socket.getOutputStream().flush();}
 private void status(String text){getSharedPreferences("relay",0).edit().putString("status",text+"\n手机已收 "+received+" · 电脑确认 "+forwarded+" · 丢弃／失败 "+dropped).apply();}
 private synchronized void log(String kind,Packet packet,int code){try{File file=new File(getFilesDir(),"relay.jsonl");if(file.length()>262144){File previous=new File(getFilesDir(),"relay.previous.jsonl");if(previous.exists())previous.delete();file.renameTo(previous);}JSONObject value=new JSONObject();value.put("atWallMs",System.currentTimeMillis());value.put("kind",kind);value.put("code",code);if(packet!=null){value.put("bootId",packet.headers.get("X-Boot-Id"));value.put("sequence",packet.headers.get("X-Sequence"));value.put("receivedWallMs",packet.wall);value.put("bytes",packet.bytes.length);}try(FileOutputStream output=new FileOutputStream(file,true)){output.write((value.toString()+"\n").getBytes("UTF-8"));}status(kind+" "+code);}catch(Exception error){status("诊断写入失败："+error.getClass().getSimpleName());}}
 public void onDestroy(){running=false;try{if(server!=null)server.close();}catch(IOException ignored){}if(sender!=null)sender.interrupt();latest.set(null);diagnostic.set(null);if(wake!=null&&wake.isHeld())wake.release();status("中继已停止");super.onDestroy();}
}
