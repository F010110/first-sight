# 三路网页预览（8884）

在项目根目录打开PowerShell运行：

```powershell
Set-Location D:\Projects\Projects2026\VLM
npm.cmd run realtime:three
```

打开 `http://127.0.0.1:8884/realtime.html`，主页和真实/模拟回放仍使用同一端口。保持终端和电脑运行；休眠、断网会中断预览。Ctrl+C结束服务。该命令不包含`--allow-paid`，模型不可启用，记录默认关闭；不要求USB连接或额外手动启动采集脚本。

前摄沿用原接收及记录路径；左右摄由独立RAM预览进程并发读取，核对各自配置中的ID、方向、会话及SHA256。左右图片不进入记录/模型，页面有明确说明。当前没有三摄曝光同步，也不将三路接收时间冒充共同曝光时间。断流保留最后画面并显示延迟/错误。

左右使用`cam/local/network-camera-left.json`和`network-camera-right.json`，前摄使用现有`network-camera.json`（前摄独立配置另有备份）。均含私有配对信息，不提交。地址变化先尝试唯一mDNS名称；不能保证校园网支持mDNS，发现失败需重新检查地址，不把未知相机接入。

验收：实际Chrome显示前、左、右三张640×480图片；左右ID正确；状态paid=false、recording=false、recordedFrames=0；页面无异常。TypeScript318/318通过。测试服务已关闭，交由用户使用上述命令启动；未完成长期在线稳定性验收。
