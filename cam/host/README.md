# 相机主机侧工具

固件只在`../src/`，PlatformIO构建钩子只在`../build/`。本目录保存电脑侧接收、配置、图像准备及相邻回归测试；必须从仓库根目录运行。私有配置仍在`cam/local/`，没有随脚本移动。

## 当前V2主链路

|文件|用途|操作边界|
|---|---|---|
|`push_stream.py`|鉴权JPEG上传接收、RAM预览／记录|Node服务启动其子进程，不额外手工再开一个8885|
|`prepare_live_image.py`|原图校验、像素等价PNG和特征|记录开启后由实时编排调用，不运行模型|
|`configure_uplink.py`|USB更新设备上传地址|会复位／修改NVS；仅10.122前缀，未经指示不操作|
|`pair_network_camera.py`|设备配对、生成本地密钥|修改设备／私有配置，已配对设备正常运行不需重复执行|

## 保留的兼容／历史工具

- `network_stream.py`：旧鉴权pull兼容链路；与push互斥，不是另一个必须启动的服务。
- `portal_stream.py`、`portal_login_probe.py`：旧校园portal接收／USB诊断；不是当前持续设备历史日志接口。
- `capture.py`、`stream.py`：旧串口抓图，不是当前无线采集。
- `wifi_receiver.py`、`mock_wifi.py`、`check_wifi.py`：旧三发送端接入与模拟，不等于已验收三摄同步。
- `probe_computer_uplink.py`：历史上行探针，会与设备／网络交互；当前暂停。
- `calibrate.py`：标定准备工具，无真实足量标定照片不得声称已完成标定。

这些文件保留复现价值，不能因目录整理自动运行、刷机或恢复网络实验。

```powershell
cam/.venv/Scripts/python.exe -m unittest discover -s cam/host -p "test_*.py"
```

相邻测试使用临时目录及本地模拟接收，不配置真实设备、不调用模型。根`tests/python/test_camera_calibration.py`另验证标定准备契约。[V2完整运行手册](../../docs/application/v2-realtime.md)。
