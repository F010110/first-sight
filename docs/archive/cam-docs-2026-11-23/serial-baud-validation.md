# 串口提速验证

## 结论

115200是此前固件与主机的配置，不是本板已达到的硬件极限。实际同一块ESP32-S3、USB转串口底座与线缆，升级后230400／460800均达到每2秒一张。未降低640×480分辨率、JPEG质量12，也未删掉每次丢弃三帧／曝光更新等待。

这不等于没有硬件上限：UART、USB转串口、线缆、驱动和供电均有限制；未验证更高档位。此前全Flash备份在921600发生过数据损坏，不为追求最高数字继续尝试该档。当前目标只是可靠满足0.5fps。

## 固件与恢复保护

1. 核验原16MB完整备份SHA256仍为`CD0F30AC9491DA499EAF2167F07B5ACCF23CF6779C506110431AA766F346273E`。
2. 升级前从`0x10000`完整读回328624字节当前应用，SHA256为`F23855652962F78EA6F97EDBD2668AD91CA199352C466B05CBD2CCCC14A94571`，与原成功采图的`local/tested-build/firmware.bin`相同。
3. 只写入新应用区`0x10000`，esptool写入哈希验证通过；不擦全片、不覆盖原bootloader、分区和原备份。
4. 每次设备上电仍为115200。`b230400\n`或`b460800\n`先在旧速率返回`BAUD_SWITCH N`，再切换并在新速率返回`BAUD_READY N`；主机必须收到两次确认。
5. 正常完成及可处理异常退出时，主机尝试协商回115200，记录`baud-restored.json`。若进程被强杀、USB拔出或协商失败，不能保证自动恢复，设备断电重上电回115200。

原`c`抓拍命令与JPEG帧格式未改。旧`capture.py`仍可在115200使用；不要与持续采集器同时占用串口。

## 编译配置修复

原PlatformIO DIO／40MHz配置首次重建失败：Arduino 2.0.17只包含`bootloader_dio_80m.elf`，没有`bootloader_dio_40m.elf`。

新增`build_bootloader.py`在项目`.pio/generated/`中将官方DIO ELF转换为DIO／40MHz／16MB镜像，并配置为自定义bootloader，不改全局工具链文件或依赖私人备份。镜像头、checksum与validation hash检查通过。

**本次设备仍保留旧已验证bootloader，只升级应用。** 新生成bootloader不是与旧二进制逐字相同，也尚未烧录启动验证；不能据此次应用升级声称全套新生成镜像已验收。

## 有界实测

| 配置 | 完整图片 | 平均请求至收完 | 最大耗时 | 平均请求间隔 | 漏采时隙 |
|---|---:|---:|---:|---:|---:|
| 旧115200／2秒目标 | 12 | 2503.5ms | 2627ms | 4000ms | 12 |
| 新230400／2秒目标 | 12 | 1164.8ms | 1381ms | 2000.09ms | 0 |
| 新460800／2秒目标 | 30 | 680.6ms | 805ms | 2000ms | 0 |
| 新460800／实时消费并行采集 | 30 | 696.1ms | 770ms | 2000ms | 0 |
| 新460800／完整实时记忆验收 | 12 | 704ms | 804ms | 2000.09ms | 0 |

场景与JPEG字节数会变化，以上不是同一批压缩字节的严格吞吐对照；串口配置提高为4倍不代表端到端速度恰好4倍。所有新图片通过长度、JPEG边界、结束符和完整解码检查；未增加设备端CRC，不能将成功解码等同于传输逐比特无误证明。

本地证据：`local/baud230400-2s-v1`、`local/baud460800-2s-v1`，均保留原图／逐帧耗时／收据／完成状态，均记录正常恢复115200。短测不是整天稳定性、动态画质或视频帧率验收。

### 实时接入验收与中断保留

- `local/baud460800-live-v1`采集30张全部成功，但`baud460800-memory-v1`消费进程被工具120秒总超时中断：30张已接收，6窗口完成，仍有1个未知调用预留。保留请求／SQLite及`external-interruption.json`，不将其称为完整记忆验收，不把预留当已知真实费用。
- 使用300秒工具超时另起全新12张运行：`local/baud460800-live-v2`与`baud460800-memory-v2`。12观察、12归属、3窗口、pending=0，完整完成；3个模型请求，估算USD0.00218，未知预留为0。没有拼接前次输出。
- 新固件高波特率结束后自动恢复115200；再以旧`c`／原JPEG协议成功抓拍2张（`local/baud-legacy115200-v1`），验证低速兼容。不代表115200在任意场景也可稳定2秒采样。

采集速率与模型吞吐分开：模型可能慢于实时，收据缓存在磁盘，摄像头采集不等待模型。运行超时应覆盖模型处理时间，不能只按采集时长设置。

## 默认使用

`run.ps1`现默认协商460800；老固件不支持协商，必须先明确升级，或传`-Baud 115200`继续原路径。底层`stream.py`默认仍115200，避免静默改变诊断脚本行为。

本机已完成升级，不必重刷。其他相同板型升级前先核对备份／引脚／已知bootloader；仅对已验证兼容的相同分区与bootloader可以像本次一样更新应用：

```powershell
cam/.venv/Scripts/python.exe -m platformio run --project-dir cam
# 覆盖应用程序，执行前确认备份、板型及端口，不作为每次采集的步骤
cam/.venv/Scripts/python.exe -m esptool --chip esp32s3 --port COM3 --baud 460800 write-flash 0x10000 cam/.pio/build/camera/firmware.bin
```

```powershell
# 实时接入现有空间记忆；只改变传输速率，不改算法
powershell -NoProfile -ExecutionPolicy Bypass -File cam/run.ps1 -CaptureDirectory cam/local/fast-001 -MemoryDirectory cam/local/fast-memory-001 -Count 30 -Interval 2 -Baud 460800 -ConfirmPaid

# 仅验证采集和观察输入，无模型费用
powershell -NoProfile -ExecutionPolicy Bypass -File cam/run.ps1 -CaptureDirectory cam/local/fast-check-001 -MemoryDirectory cam/local/fast-input-001 -Count 30 -Interval 2 -Baud 460800
```

协议回归6项、全部TypeScript测试220项、冻结／布局校验5项及文档链接检查通过。核心Context、模型提示、SQLite和调度均未改变，正式版标签未移动。
