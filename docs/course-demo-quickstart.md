# First Sight 课内演示快速操作手册（三摄硬件 + 手机语音输出）

本入口是**独立课内演示分支功能**（[src/course-demo/](../src/course-demo/demo-server.ts) + [web/course-demo/](../web/course-demo/index.html)），**不启动复杂空间记忆建模**、**不修改 `cam/local/` 既有配对文件**，也不会覆盖任何历史科研数据。

---

## 1. 启动前准备

1. **确认既有环境变量（不要覆盖已配置的自定义端点）**
   系统已读取本机用户环境变量 `QWEN_API_KEY` 与 `QWEN_BASE_URL`（[qwen-vision.ts](../src/course-demo/qwen-vision.ts) 直接沿用这两个变量，并以 `${QWEN_BASE_URL}/chat/completions` 发起请求，与现有主线 [spatial-json-vlm.ts](../src/agent/spatial-json-vlm.ts) 保持完全一致）。
   **不要在 PowerShell 中手工赋值为其他示例 URL**，启动前如需核对是否已加载（不打印密钥值），可运行：
   ```powershell
   Write-Output "API_KEY=$([bool]$env:QWEN_API_KEY) BASE_URL=$([bool]$env:QWEN_BASE_URL)"
   # 可选指定模型（默认 qwen3.8-flash）
   # $env:QWEN_DEMO_MODEL = "qwen3.8-flash"
   ```
2. **网络条件（重要）**
   - 三台已烧录配对的 ESP32-S3（前/左/右）固件默认连接 `BUPT-portal`。
   - **电脑与手机（以及三台相机）需处于可互通的同一局域网**；若手机使用 4G/5G 流量或校园网禁止设备间互访，请使用下方 `--tunnel` 模式。

---

## 2. 一键启动演示服务

### 方式 A：同局域网直连（推荐在设备可互访的 Wi-Fi 下使用）
```powershell
Set-Location D:\Projects\Projects2026\VLM
npm.cmd run demo
```

### 方式 B：启用 Cloudflare HTTPS 隧道（推荐校园网隔离或需 iPhone/Android 网页麦克风时使用）
```powershell
Set-Location D:\Projects\Projects2026\VLM
npm.cmd run demo:tunnel
```

启动后：
- 在电脑浏览器打开 `http://127.0.0.1:8890/`（主控台）。
- 如电脑有多个网卡（如虚拟网卡 + Wi-Fi），可在主控台“手机扫码语音输出”下拉框中切换到实际无线局域网 IP 或 HTTPS 隧道地址。

---

## 3. 移动位置 / 换教室后自动定位三摄 IP

三台相机重新上电或更换 Wi-Fi AP 后 IP 可能变化。无需重新烧录固件，也不用手动改 `cam/local/`：

1. 将三台 ESP32-S3 接通电源，等待约 10–15 秒完成 Wi-Fi 连网。
2. 主控台启动时会自动执行 **4 级定位**（历史缓存 IP → `<cameraId>.local` mDNS → UDP `33333` 广播探测 → ARP 缓存 + 局域网并发 80 端口校验）。
3. 若处于跨网段校园网（电脑与相机在同一大网但不同 `/24` 子网，广播无法跨网段），请在主控台“补充网段”输入框填入相机所在网段（例如 `10.122.241.0/24`），再点击 **“自动定位三摄 IP”**。
4. 若已知某台相机 IP，也可直接在面板输入后点击 **“应用 IP”**（配置保存在 `run/course-demo/camera-hosts.json`，下次启动自动优先复用）。
5. **USB 串口兜底工具（仅当无线定位全部失败时使用）**：将单台相机连上电脑 USB 后运行：
   ```powershell
   cam\.venv\Scripts\python.exe cam\host\demo_camera_tool.py serial-ip --port COM3 --disable-uplink
   ```
   该命令会从串口读取设备当前 IP 并写入 `run/course-demo/camera-hosts.json`；附加 `--disable-uplink` 可关闭前摄里旧的 `8885` 主动推送地址，避免它每隔几秒连接旧电脑 IP 造成 `/v1/frame` 响应卡顿。

> 注：即便只有 1 台或 2 台相机在线，系统仍可正常问答，模型只会依据实际在线的视角作答并明确提示缺失方向。

---

## 4. 手机语音播报（iPhone Safari & Android Chrome）

1. 用手机浏览器扫描电脑主控台二维码（携带配对 Token 自动鉴权）。
2. **必做一步**：进入手机页后，点击页面顶部蓝色大按钮 **“点击开启手机语音播报”**（绕过 iOS Safari / Android 浏览器的自动发声拦截，并自动申请屏幕常亮）。
3. 回到电脑主控台点击 **“测试手机语音”**（0 模型费用），确认手机已清晰播报“First Sight 手机语音连接正常，可以开始演示。”。
4. 演示时可在电脑端或手机端直接点击：
   - **多视角环境描述**（融合前/左/右三摄说明周围布局、物体与方位）
   - **读眼前文字**（朗读标牌/卡片/屏幕文字，看不清不编造）
   - **识别物品**（识别前方或手中物品名称与特征）
   - **自由提问**（输入或使用手机听写/麦克风提问）
5. **iOS 兜底**：若 iPhone 锁屏切后台后被系统暂停自动发声，手机端顶部会弹出黄色 **“点这里立即朗读最新回答”** 按钮，点一下即可立即续播。

---

## 5. 演示前无硬件快速彩排

若上台前想先验证 Qwen 响应与手机语音链路：
- 展开主控台左下角 **“演示备用：手动注入本地测试 JPEG”**，上传本地 JPG 测试图（界面明确标记为“测试图”），即可直接完整跑通问答与手机播报。
- 不需要连接真机时也可用 `npm.cmd run demo -- --no-cameras` 启动纯演示页面。
