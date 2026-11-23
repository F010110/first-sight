# 硬件、运行与安全

## 本地环境【本次已知】

- Windows/PowerShell，仓库`D:\Projects\Projects2026\VLM`。
- TypeScript/Node主链，Python工具优先用现有`.venv/Scripts/python.exe`，不另装环境。
- `package.json`要求Node≥22.13；`npm.cmd run build`输出到`dist/current`。
- Git工作区含其他未提交修改；不要以清理/回退为由覆盖。
- Qwen配置使用`QWEN_API_KEY`、`QWEN_BASE_URL`；本区只写变量名，不保存值。近期实验模型`qwen3.8-flash`、temperature=0；这仍不保证完全可重复。

## 三摄工程冻结【已验证短测，不是全功能】

ESP32-S3/OV2640三台独立角色，ID来自eFuse：

|角色|cameraId|
|---|---|
|front|first-sight-7c2ac59fc114|
|left|first-sight-3878c59fc114|
|right|first-sight-cc4ac69fc114|

曾逐台配对、应用区烧录和读回验证；每路收到3张640×480图，身份/hash/解码通过，跨摄密钥401隔离通过。区域备份不是全16MB备份。固件、配对密钥及备份在私有`cam/local/`，不复制或上传。

三摄预览不等于三摄建模：正式v2.1.0里前摄沿用记录/模型路径，左右只是RAM预览。三摄持久录制、模型同时输入、曝光同步、设备时钟、长时佩戴/供电/重连未验收。新位姿拓扑也未接硬件主链。

## 网页与开关

```powershell
npm.cmd run realtime:three
```

入口：`http://127.0.0.1:8884/realtime.html`；统一8884首页、真实/模拟回放、一个模拟选择器。前图大，左/右图在右边上下排列；记录和付费模型默认关闭，预览RAM-only。

此命令是操作参考，**本次没有启动/停止服务**。服务由用户保持，不因文档整理重启。`npm.cmd run realtime`是旧单摄入口，不能随意替代三摄默认命令。

## 已知故障【历史诊断，未恢复】

移动位置后旧IP超时，唯一mDNS/广播发现未成功，前摄接收器曾停止。不能仅凭旧IP或电脑与相机在同一校园网就认为可达；可能存在客户端隔离等，原因未完全确认。

动态发现/配对后的寻址恢复、专用Wi-Fi/热点、网络拓扑与实机恢复均暂缓；不擅自刷固件、重置设备、修改防火墙或扫描新网段。没有可确认的当前在线IP，本区不固化旧IP。

证据：`docs/releases/v2.1.0.md`、`cam/docs/camera-role-register.md`、`cam/docs/three-camera-web-preview.md`及`TODO.md`历史诊断。
