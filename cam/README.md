# ESP32-S3-CAM · V2硬件入口

当前使用`camera-network`固件：单摄640×480 JPEG16，校园网认证后主动向电脑8885上传。正常使用无需USB，USB用于配置与刷写。**已实际无线接入实时页面，但存在明显断联，未通过稳定移动使用验收。** 三摄同步／校准／并发未验收；不是UVC摄像头。

当前路径：`src/main.cpp`＋`src/network_camera.h` → 电脑`push_stream.py` → `../src/hardware/` → [V2实时页／回放](../docs/application/v2-realtime.md)。旧`network_stream.py`为电脑pull兼容链路，不与push同时使用。

```powershell
# 在仓库根目录；仅构建，不自动刷机
cam/.venv/Scripts/python.exe -m platformio run -d cam -e camera-network
```

配对密钥和校园凭据在忽略的`local/`及设备NVS中，NVS未加密，不打印、不提交、不做整片Flash导出。固件保留传感器方向校正与低光调整。主动上传基线53afa22，后续RAM／Flash诊断和手机热点实验已回退；历史日志不删除。

当前硬件／通信开发暂停，不能因下列历史记录中出现“下一步”就自动刷写其他env或恢复试验。[完整架构](../docs/product/v2-system-map.md) · [已知问题与未来架构](../docs/product/future-wearable-architecture.md)。

## 历史串口接入（不是当前运行方式）

三摄Wi-Fi准备及640×480／160°广角模拟：[实现、操作与限制](docs/wifi-and-optics-preparation.md)。Wi-Fi固件已编译、本地三发送端协议已测，尚未进行实机无线测试；当前板上串口固件不变。

参见[接入操作和实测](docs/serial-integration.md)。单摄只提供一个实际视图。旧115200配置曾未达到2秒目标；本次升级可协商波特率的固件后，**230400／460800均实测达到每2秒一张**，不降低640×480分辨率或JPEG质量。见[提速验证与恢复规则](docs/serial-baud-validation.md)。`run.ps1`默认460800，设备启动和底层诊断脚本仍115200。

## 历史初次硬件验证结论

已通过 USB 转串口烧录测试固件，并连续获取三张 **640×480 JPEG**。第三张已人工查看，能看到现场景物，没有观察到黑屏或花屏。说明摄像头基本采集、JPEG 输出、ESP32 缓冲及串口传输链路可用；不是高分辨率、长期稳定性或全部硬件功能的验收。

设备当前保留串口拍照测试固件，**不是 USB 摄像头/UVC，也不是 Wi-Fi 视频流服务**。设备自身不运行模型；主机现可接收原图并调用现有模型／记忆链。

## 历史工具目录（保留复现）

| 路径 | 内容 |
|---|---|
| `docs/hardware-and-validation.md` | 硬件规格、引脚、实测过程与限制 |
| `docs/operation.md` | 环境准备、拍照协议、编译与烧录注意事项 |
| `docs/integration-plan.md` | 后续接入的建议边界和待验证事项，仅设计说明 |
| `platformio.ini`、`src/main.cpp` | 独立摄像头测试固件 |
| `capture.py` | 主机串口抓取三张 JPEG 的测试脚本 |
| `stream.py`、`run.ps1` | 有界连续抓拍与主机实时接入；默认仅校验，模型需显式确认 |
| `local/` | 本地原始照片、抓拍、完整固件备份及日志，已被 git 忽略 |

## 使用前必读

- 打开串口可能因底座控制线状态导致板子复位；不要同时启动两个串口工具。
- COM3 是本次 Windows 环境的端口，不是固定设备标识。
- 不要直接给其他 ESP32-CAM 板子使用这份引脚配置。
- 烧录会覆盖板上程序；先保留并校验原固件备份。不要为了拍照重复刷机。
- 抓拍可能包含人员或私人环境，不上传或提交 `local/` 内容。
- 本目录的依赖与项目根目录 Python/Node 依赖隔离；未更改根目录依赖或构建入口。
