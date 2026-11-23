# ESP32-S3-CAM 硬件模块（课内版）

本目录保存三台 ESP32-S3 / OV2640 相机（`front` / `left` / `right`）的固件源码、电脑端采集/IP 定位脚本与配对工具。

- 固件源码：`cam/src/main.cpp`、`cam/src/network_camera.h`、`cam/src/portal_session.h`
- 角色与 MAC 登记：[camera-role-register.md](docs/camera-role-register.md)
- 电脑端工具导航：[host/README.md](host/README.md)
- 私有配对密钥与芯片备份：`cam/local/`（已由 `.gitignore` 忽略，禁止提交或泄露）

## 固件编译参考（通常无需重新烧录）

```powershell
cam/.venv/Scripts/python.exe -m platformio run -d cam -e camera-network-front
```
