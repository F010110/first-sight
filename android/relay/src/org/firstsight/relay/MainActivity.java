package org.firstsight.relay;

import android.app.Activity;
import android.os.Bundle;
import android.os.Handler;
import android.content.Intent;
import android.widget.*;
import android.text.InputType;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.util.*;

public class MainActivity extends Activity {
 private TextView status;private EditText host,key;private final Handler handler=new Handler();
 private final Runnable update=new Runnable(){public void run(){
  status.setText("本机IPv4（热点网关需从中确认）：\n"+addresses()+"\n接收端口：8885\n"+getSharedPreferences("relay",0).getString("status","未启动"));handler.postDelayed(this,1000);
 }};
 public void onCreate(Bundle state){super.onCreate(state);
  LinearLayout layout=new LinearLayout(this);layout.setOrientation(1);layout.setPadding(24,24,24,24);
  TextView title=new TextView(this);title.setText("First Sight · Android中继（连接验证版）");title.setTextSize(20);layout.addView(title);
  TextView note=new TextView(this);note.setText("先连接校园Wi-Fi并开启2.4GHz热点。仅预览中继，不缓存图片；手机收到≠电脑收到。开启后保留前台通知，首次先不要锁屏。配置仅存手机私有目录，不包含模型密钥。");layout.addView(note);
  host=new EditText(this);host.setSingleLine();host.setHint("电脑接收地址，如 http://10.122.241.38:8885");host.setText(getSharedPreferences("relay",0).getString("host","http://10.122.241.38:8885"));layout.addView(host);
  key=new EditText(this);key.setSingleLine();key.setHint("设备配对密钥（建议导入本地配置）");key.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD);key.setText(getSharedPreferences("relay",0).getString("token",""));layout.addView(key);
  Button load=new Button(this);load.setText("导入中继配置JSON");load.setOnClickListener(v->{Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT);intent.setType("application/json");intent.addCategory(Intent.CATEGORY_OPENABLE);startActivityForResult(intent,1);});layout.addView(load);
  Button start=new Button(this);start.setText("启动中继");start.setOnClickListener(v->{try{
   RelayService.validateDestination(host.getText().toString().trim());String token=key.getText().toString().trim();if(!token.matches("[a-fA-F0-9]{64}"))throw new Exception("配对密钥应为64位十六进制");
   getSharedPreferences("relay",0).edit().putString("host",host.getText().toString().trim()).putString("token",token).commit();
   if(android.os.Build.VERSION.SDK_INT>=33&&checkSelfPermission("android.permission.POST_NOTIFICATIONS")!=0)requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"},3);
   startForegroundService(new Intent(this,RelayService.class));
  }catch(Exception error){Toast.makeText(this,error.getMessage(),Toast.LENGTH_LONG).show();}});layout.addView(start);
  Button stop=new Button(this);stop.setText("停止中继");stop.setOnClickListener(v->stopService(new Intent(this,RelayService.class)));layout.addView(stop);
  Button export=new Button(this);export.setText("导出诊断元数据（无图像／密钥）");export.setOnClickListener(v->{Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT);intent.setType("text/plain");intent.putExtra(Intent.EXTRA_TITLE,"first-sight-relay-log.txt");startActivityForResult(intent,2);});layout.addView(export);
  status=new TextView(this);layout.addView(status);ScrollView scroll=new ScrollView(this);scroll.addView(layout);setContentView(scroll);
 }
 protected void onResume(){super.onResume();handler.post(update);}protected void onPause(){handler.removeCallbacks(update);super.onPause();}
 protected void onActivityResult(int request,int result,Intent intent){super.onActivityResult(request,result,intent);if(result!=RESULT_OK||intent==null)return;
  try{if(request==1){try(InputStream input=getContentResolver().openInputStream(intent.getData())){ByteArrayOutputStream data=new ByteArrayOutputStream();byte[] b=new byte[1024];int n;while((n=input.read(b))!=-1){data.write(b,0,n);if(data.size()>8192)throw new IOException("配置过大");}JSONObject config=new JSONObject(data.toString("UTF-8"));host.setText(config.getString("host"));key.setText(config.getString("token"));}}
   else if(request==2){try(OutputStream output=getContentResolver().openOutputStream(intent.getData())){for(String name:new String[]{"relay.previous.jsonl","relay.jsonl"}){File file=new File(getFilesDir(),name);if(!file.exists())continue;try(InputStream input=new FileInputStream(file)){byte[] b=new byte[4096];int n;while((n=input.read(b))!=-1)output.write(b,0,n);}}}}
  }catch(Exception error){Toast.makeText(this,"导入／导出失败："+error.getClass().getSimpleName(),Toast.LENGTH_LONG).show();}
 }
 private String addresses(){StringBuilder text=new StringBuilder();try{for(NetworkInterface net:Collections.list(NetworkInterface.getNetworkInterfaces()))for(InetAddress address:Collections.list(net.getInetAddresses()))if(address instanceof Inet4Address&&!address.isLoopbackAddress())text.append(net.getName()).append(": ").append(address.getHostAddress()).append('\n');}catch(Exception ignored){}return text.toString();}
}
