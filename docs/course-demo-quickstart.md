# First Sight 课内演示快速操作手册（三摄硬件 + 手机语音输出）

本手册面向重构后的课内主入口（[src/server.ts](../src/server.ts) + [web/index.html](../web/index.html)），**不启动复杂空间记忆建模**、**不修改 `cam/local/` 既有配对文件**，所有运行时数据统一写入 `run/course-demo/`。

---

## 1. 启动前准备

1. **确认既有环境变量（不要覆盖已配置的自定义端点）**
   系统会直接读取本机环境变量 `QWEN_API_KEY` 与 `QWEN_BASE_URL`（[qwen-vision.ts](../src/vision/qwen-vision.ts) 以 `${QWEN_BASE_URL}/chat/completions` 发起请求，默认模型 `qwen3.8-flash`）。
   **不要在 PowerShell 中手工赋值为其他示例 URL**，启动前如需核对是否已加载（不打印密钥值），可运行：
   ```powershell
   Write-Output "API_KEY=$([bool]$env:QWEN_API_KEY) BASE_URL=$([bool]$env:QWEN_BASE_URL)"
   # 可选指定模型（默认 qwen3.8-flash）
   # $env:QWEN_DEMO_MODEL = "qwen3.8-flash"
   ```
2. **网络条件**
   - 三台已烧录配对的 ESP32-S3（前/左/右）固件默认连接 `BUPT-portal`。
   - 电脑、手机与相机在可互访的同一局域网时直接用 `npm.cmd run demo`；若校园网禁止设备间互访或需网页麦克风，请用 `npm.cmd run demo:tunnel`。

---

## 2. 一键启动与展示台布局

```powershell
Set-Location D:\Projects\Projects2026\VLM

# 方式 A：同局域网直连
npm.cmd run demo

# 方式 B：启用 Cloudflare HTTPS 隧道（校园网设备隔离 / 需 iPhone/Android 网页麦克风时推荐）
npm.cmd run demo:tunnel
```

启动后打开电脑主控台 `http://127.0.0.1:8890/`（只读历史回放：`http://127.0.0.1:8890/replay.html`）：
1. **顶部 4 步实时状态条**：直观展示 `1. 硬件三摄采集 → 2. 电脑计算调度 → 3. 网页画面与输出 → 4. 手机语音播报`。
2. **“设备与扫码配置”抽屉**：包含手机扫码二维码、三摄 IP 自动定位及测试源；完成配对并确认三摄在线后，点击右上角 **“演示模式”** 即可收起配置抽屉，让投影屏幕聚焦三摄实时画面与大字输出区。

---

## 3. 移动位置 / 换教室后自动定位三摄 IP

三台相机重新上电或更换 AP 后 IP 可能变化，无需重新烧录固件，也不用手动改 `cam/local/`：

1. 将三台 ESP32-S3 接通电源，等待约 10–15 秒完成 Wi-Fi 连网。
2. 主控台启动时会自动执行 **4 级定位**（历史缓存 IP → `<cameraId>.local` mDNS → UDP `33333` 广播探测 → ARP 缓存 + 局域网并发 80 端口校验）。
3. 若处于跨网段校园网（广播无法跨 `/24` 子网），在配置抽屉“补充网段”输入框填入相机所在网段（例如 `10.122.241.0/24`），再点击 **“自动定位三摄”**。
4. 若已知某台相机 IP，也可直接在面板输入后点击 **“应用”**（保存在 `run/course-demo/camera-hosts.json`，下次启动优先复用）。
5. **USB 串口兜底（仅无线定位全失败时使用）**：单台相机连上 USB 后运行：
   ```powershell
   cam\.venv\Scripts\python.exe cam\host\demo_camera_tool.py serial-ip --port COM3 --disable-uplink
   ```
   （`--disable-uplink` 可关闭前摄旧的 `8885` 主动推送地址，避免它每隔几秒连接旧电脑 IP 导致 `/v1/frame` 响应卡顿。）

> 即便只有 1 台或 2 台相机在线，系统仍可正常工作，模型只依据在线视角回答并明确提示缺失方向。

---

## 4. 手机语音播报（iPhone Safari & Android Chrome）

1. 用手机浏览器扫描配置抽屉中的二维码（自动携带配对 Token）。
2. **必做一步**：点击手机页面顶部蓝色大按钮 **“点击开启手机语音播报”**（一次性解锁浏览器 `speechSynthesis` 并申请屏幕常亮）。
3. 回到电脑端点击 **“测试手机语音”**（0 模型费用），确认手机正常播报。
4. 支持四种即时交互 + 持续 Watch 提醒：
   - **多视角环境描述** / **读眼前文字** / **识别物品** / **自由提问**
   - **持续目标关注（Watch 模式）**：输入关注目标（如“蓝色水杯”或“有人走近”），系统每 4 秒检查新画面（无新帧不重复调用模型），发现目标自动保存证据并向手机语音报警；随时可点击“取消”停止。
5. **iOS 兜底**：若 iPhone 锁屏切后台后被系统暂停自动发声，手机端顶部会弹出黄色 **“点这里立即朗读最新回答”** 按钮，点一下即可立即续播。

---

## 5. 演示前无硬件彩排与会后回放

- 在“设备与扫码配置”抽屉右侧 **“演示备用测试源”** 中，可直接开启笔记本自带摄像头实时推流到 `front`（或上传本地 JPEG，界面均明确标为“测试图”），完整彩排 Qwen 问答、Watch 提醒与手机语音。
- 无需真机子进程时可运行 `npm.cmd run demo -- --no-cameras`。
- 所有演示问答与命中提醒会自动保存在 `run/course-demo/sessions/`，打开 `http://127.0.0.1:8890/replay.html` 即可零费用回顾证据图并一键重播到手机。
