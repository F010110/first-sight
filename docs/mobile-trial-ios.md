# 手机试用（iOS / 局域网 HTTPS）安装说明

本项目在手机上是一个网页试用工具。iOS 的 Safari 要求 **HTTPS** 才允许访问摄像头，因此需要在电脑上生成一张本地 CA 证书，装到手机上并信任，然后通过局域网地址访问。

## 0. 前置条件

- 一台 Windows 电脑和一部与电脑**同一 Wi-Fi** 的 iPhone。
- Node.js ≥ 20。
- Python 3 + OpenCV（图片记忆的匹配算法用；见 `requirements.txt`）。
- 已配置 Qwen 凭据（服务端环境变量）：`QWEN_API_KEY`、`QWEN_BASE_URL`，可选 `QWEN_MODEL`（默认 `qwen3-vl-plus`）。

## 1. 电脑端准备

```powershell
# 依赖
npm.cmd install
python -m pip install -r requirements.txt        # 建议在 .venv 中；提供 scripts/image_match.py 的 OpenCV

# 生成局域网 HTTPS 证书（写出 run/tls/，内含 CA 证书和服务器证书）
powershell -ExecutionPolicy Bypass -File scripts/setup-lan-tls.ps1
```

脚本会探测本机局域网 IPv4，并生成：

- `run/tls/vlm-local-ca.cer` —— 需要装到手机并信任的 CA
- `run/tls/vlm-server.pfx` —— 服务端证书
- `run/tls/lan-ip.txt` —— 局域网地址

## 2. 启动服务

```powershell
$env:VLM_TRIAL_PASSCODE = "hjl"      # 至少 3 位的临时口令
npm.cmd run trial:web
```

启动后终端会打印：

- 网页：`https://<LAN-IP>:8765/vlm`
- CA 安装页（普通 HTTP，不需要证书）：`http://<LAN-IP>:8767/`

电脑上可先用 `http://localhost:8765` 检查界面。

## 3. iPhone 安装并信任 CA

1. **下载**：用 iPhone 的 **Safari** 打开 `http://<LAN-IP>:8767/`，按提示下载 `vlm-local-ca.cer`。
2. **安装描述文件**：`设置 → 通用 → VPN 与设备管理`（旧系统为“描述文件”），点开刚下载的 “VLM Local Dev CA”，点“安装”，输入锁屏密码。
3. **信任**：`设置 → 通用 → 关于本机 → 证书信任设置`，打开 “VLM Local Dev CA” 的完全信任开关。
   > 第 3 步不能省，否则 Safari 仍会拦截 `https://<LAN-IP>:8765`。

## 4. 打开试用页并授权

1. Safari 打开 `https://<LAN-IP>:8765/vlm`，输入口令（`VLM_TRIAL_PASSCODE`）登录。
2. 点“开启摄像头”：
   - 允许摄像头权限；
   - iOS 会请求**运动与方向**权限（`DeviceMotionEvent.requestPermission`），**必须允许**——否则运动模式不可用。
3. 页面有三条独立观察线：
   - **场景**：自动记录当前地点、是否是新场景 / 回到已知场景；
   - **场景变化**：同一地点内部的变化（物体移动、人出现、开关门等）；
   - **用户要求**：填写问题 / 目标 → “提问 / 设定目标”；或填写关注条件 → “关注这个情况”。

## 5. 其他页面

| 地址 | 用途 |
|---|---|
| `/vlm` | 主试用页（三条观察线） |
| `/vio` | VIO 探针：`记录 12 秒` 采集一段 160×120 灰度帧 + IMU，用于离线分析 |
| `/report` | 离线运动轨迹报告列表（VIO 轨迹 / IMU 轨迹） |
| `/spatial-probe` | 浏览器空间/深度能力探针（实验） |

## 6. 常见问题

- **打不开 https，提示证书不受信任**：回到第 3 步，确认已在“证书信任设置”里开启完全信任。
- **没有运动/方向数据**：确认第 4 步允许了“运动与方向”；部分会话 `alpha` 或 `rotationRate` 可能为空。
- **`/api/...` 返回 503**：服务端未配置 `QWEN_API_KEY` / `QWEN_BASE_URL`。
- **`/api/...` 返回 401**：口令错误或会话过期（默认 4 小时），重新登录。
- **图片匹配永远不触发**：确认 Python 环境可 `import cv2`（`python -c "import cv2"`）。
- **换 Wi-Fi / IP 变了**：重新运行 `scripts/setup-lan-tls.ps1` 并在手机上重新信任。
