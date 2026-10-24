# 独立测试操作

> 当前固件新增了显式波特率协商，原115200 `c`命令不变；主机接入默认使用460800。详见[提速验证](./serial-baud-validation.md)，旧抓拍脚本使用前确保设备已恢复115200或断电重启。

以下命令从项目根目录运行，仅用于硬件测试，不启动手机端或模拟器。

## 隔离环境

```powershell
python -m venv cam/.venv
cam/.venv/Scripts/python.exe -m pip install platformio==6.2.0 esptool==5.6.0 pyserial==3.5
```

原实测使用 Python 3.14；PlatformIO 平台固定为 espressif32 6.10.0，Arduino ESP32 2.0.17，Xtensa 工具链 8.4.0。首次构建需要下载工具链。不要把工具包加入根目录业务依赖。

## 已烧录时：只抓拍

```powershell
$env:PYTHONIOENCODING = 'utf-8'
cam/.venv/Scripts/python.exe cam/host/capture.py
```

脚本使用 COM3、115200、8N1，关闭主动 DTR/RTS；端口变化需修改 `capture.py`。每次请求前固件丢弃三帧用于更新曝光，再采一帧。原始脚本会在自身目录输出 `capture-1.jpg` 至 `capture-3.jpg`；本目录归档版已改为输出 `local/`，避免误提交图片。

主机发送 ASCII `c`（无需换行）。固件回应：

```text
FRAME <JPEG字节数> <宽> <高>\n
<指定长度的二进制JPEG>
\nEND_FRAME\r\n
```

启动日志可能包含 `TEST PSRAM=... FLASH=...`、`CAMERA_INIT=0x0`、`SENSOR_PID=...`、`READY`。失败时可能返回 `CAMERA_NOT_READY` 或 `CAPTURE_FAILED`。主机必须按长度读取二进制，不能把 JPEG 当作文本行或靠搜索 END_FRAME 切图。现协议无校验和、序号或时间戳，只适合人工诊断。

## 重新编译与烧录（会覆盖设备程序）

先确认备份仍存在且 SHA256 与实测记录一致，并关闭所有占用 COM3 的程序。

```powershell
cam/.venv/Scripts/python.exe -m platformio run --project-dir cam
```

`platformio.ini` 将启动 Flash 模式记录为 DIO / 40 MHz，PSRAM 使用 `qio_opi` 内存类型及 `BOARD_HAS_PSRAM`。这两类设置不可混为一谈。新增`build_bootloader.py`已解决工具链缺少dio_40m ELF的构建问题。**本次只烧录新应用，保留旧bootloader；新生成bootloader尚未烧录启动验证**。最初成功的二进制仍在`local/tested-build/`，不可冒称它是当前提速固件。

如需复现已实测版本，使用归档的四个二进制，而不是重新生成后假定完全一致：

```powershell
cam/.venv/Scripts/python.exe -m esptool --chip esp32s3 --port COM3 --baud 460800 write-flash --flash-mode dio --flash-freq 40m --flash-size 16MB 0x0 cam/local/tested-build/bootloader.bin 0x8000 cam/local/tested-build/partitions.bin 0xe000 cam/local/tested-build/boot_app0.bin 0x10000 cam/local/tested-build/firmware.bin
```

若自动下载失败，可尝试按住 IO0，按下并松开 RST，再松开 IO0，之后重试连接。不要带电插拔摄像头排线。

## 备份与恢复

完整读取需要数分钟，设置足够超时，不要把文件存在或部分读取当作成功：

```powershell
cam/.venv/Scripts/python.exe -m esptool --chip esp32s3 --port COM3 --baud 460800 read-flash 0 0x1000000 cam/local/backup-new.bin
Get-FileHash cam/local/original-16mb-retry.bin -Algorithm SHA256
```

原固件恢复属于显式的覆盖操作；仅在确实需要恢复时运行：

```powershell
cam/.venv/Scripts/python.exe -m esptool --chip esp32s3 --port COM3 --baud 460800 write-flash 0x0 cam/local/original-16mb-retry.bin
```

没有执行过恢复测试。不要执行全片擦除作为常规排障步骤。串口损坏先降低波特率，检查线缆、供电和端口占用，不能据此直接判摄像头故障。
