# First Sight 课内版系统架构

本版本面向**可穿戴三摄硬件 + 多视角视觉交互展示**，采用 **四段式实时展示链路**：

```text
① 硬件三摄采集
三台 ESP32-S3 / OV2640 (front / left / right, 640×480 JPEG)
  │ LAN HTTP (/v1/status, /v1/frame) + Bearer Token + SHA256
  ▼
Python 硬件采集与 4 级 IP 定位 (cam/host/three_camera_demo.py)
  ├─ 1. 历史缓存 IP (run/course-demo/camera-hosts.json)
  ├─ 2. mDNS (<cameraId>.local)
  ├─ 3. UDP 33333 多设备广播探测
  └─ 4. ARP + 局域网/指定网段并行 80 端口校验
  │ (stdout NDJSON / stdin 控制指令)
  ▼
② 电脑本地计算 (Node.js 模块化服务, src/)
  ├─ CameraHub (src/camera-hub.ts)             ← RAM 最新帧、SHA256 校验、测试图注入
  ├─ QwenVision (src/vision/qwen-vision.ts)    ← 沿用环境变量 QWEN_API_KEY / QWEN_BASE_URL
  ├─ WatchManager (src/vision/watch-manager.ts)← 帧指纹去重、定时目标监测与取消/超时隔离
  ├─ SessionStore (src/recording/session-store.ts) ← 证据图片与 JSONL 事件只追加归档
  ├─ SseHub / Tunnel / Auth (src/sse-hub.ts, src/tunnel.ts, src/auth.ts)
  └─ HTTP Server (src/server.ts)
        │
        ├─▶ ③ 网页画面与输出
        │     ├─ 电脑展示台 (web/index.html + web/desktop.js + web/shared.js)
        │     │    ├─ 四段式实时状态条 + 三摄实时影院画面 + 最新输出高亮区 (Hero Spotlight)
        │     │    └─ 可折叠“设备与扫码配置”抽屉 + 一键“演示模式”全屏聚焦
        │     └─ 只读会话回放 (web/replay.html + web/replay.js, 零模型费用)
        │
        └─▶ ④ 手机语音播报
              └─ 手机语音伴侣 (web/mobile.html + web/mobile.js, SSE 实时推送 + TTS)
```

## 核心能力与模块契约

1. **三摄融合与缺失优雅降级**：问答与 Watch 检查打包当前在线视角（`front` / `left` / `right`），带相对方位标签与画面延迟秒数；任一侧相机离线时明确告知模型缺失方向，严禁臆测补全。
2. **四种问答模式**：
   - `describe`：多视角环境描述（身体相对方位：正前方 / 左侧 / 右侧）。
   - `ocr`：读文字与标牌（看不清或反光如实拒猜并给出调整角度建议）。
   - `identify`：识别眼前或手中主要物品与外观位置特征。
   - `custom`：结合当前多视角画面直接回答自由提问。
3. **Watch 持续关注模式**：周期性检查新画面（默认每 4 秒一次，默认有效 90 秒）；通过三摄帧 ID 指纹去重，无新画面不消耗 VLM 调用；命中目标时立刻保存证据并经 SSE 向手机推送语音报警。
4. **移动语音输出与展示分离**：网页前端使用 `web/shared.js` 统一数据渲染；电脑网页专注“画面与大字输出展示”，手机网页专注“语音播报与便携触发”，通过 `GET /api/events`（SSE）实时同步。
5. **只读会话回放**：每次问答和命中提醒均将实际使用的原图与输出保存到 `run/course-demo/sessions/<sessionId>/`，支持在 `/replay.html` 无模型调用重放与重播到手机。
