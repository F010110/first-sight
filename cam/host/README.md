# 相机主机侧工具（课内版）

电脑端通过 Wi-Fi 拉取已烧录配对的 `front` / `left` / `right` 三台 ESP32-S3 画面，并提供换地点后的自动 IP 重定位能力。必须从仓库根目录运行；私有配对密钥保存在 `cam/local/`（只读，不修改）。

| 文件 | 用途 | 说明 |
|---|---|---|
| `three_camera_demo.py` | 三摄实时拉流 + 4 级自动 IP 定位 | 由 Node 演示服务自动拉起，定位结果保存在 `run/course-demo/camera-hosts.json` |
| `demo_camera_tool.py` | 命令行定位 / USB 串口读 IP 辅助 | `locate` 扫描局域网；`serial-ip --disable-uplink` 可通过串口读取 IP 并关闭旧 push |
| `pair_network_camera.py` | 新设备首次配对 | 仅在更换新主板时使用，正常演示无需重复运行 |
| `test_three_camera_demo.py` | 三摄接收与发现单元测试 | 零模型调用、使用本地模拟 HTTP/UDP 相机 |

```powershell
cam/.venv/Scripts/python.exe -m unittest discover -s cam/host -p "test_three_camera_demo.py" -v
```
