# 摄像头角色登记与逐台配置

用户指定当前已验证的第一台为前摄。设备只能逐台通过USB接入，不要求三台同时连接或同时烧录。

| 逻辑名称 | 方向 | 当前固件报告名 | 本次USB串口适配器序列号 | 当时串口 | 状态 |
|---|---|---|---|---|---|
| cam-front | front／前 | first-sight-cam；cameraId=first-sight-7c2ac59fc114 | A5069RR4 | COM3 | 2026-10-25 已重刷身份固件并验证Wi-Fi及3张640×480图片的ID/方向 |
| cam-left | left／左 | first-sight-cam；cameraId=first-sight-3878c59fc114 | 未独立登记（不可用底座标识代替芯片身份） | COM3 | 2026-10-25 已烧录、独立配对及Wi-Fi图片验证 |
| cam-right | right／右 | first-sight-cam；cameraId=first-sight-cc4ac69fc114 | 未独立登记（不可用底座标识代替芯片身份） | COM3 | 2026-10-25 已烧录、独立配对及Wi-Fi图片验证 |

`cam-front`是主机逻辑名称；设备固件现在通过状态接口和每帧HTTP头报告唯一`cameraId=first-sight-7c2ac59fc114`及`direction=front`。ID由ESP eFuse MAC生成，其数字格式为Arduino返回的64位值；esptool报告的常规MAC表示为`14:c1:9f:c5:2a:7c`，二者字节显示顺序不同。`first-sight-cam`仅保留为协议家族名。mDNS/hostname改为唯一cameraId。

A5069RR4属于USB串口适配器，若底座被多台相机复用，不能用它区分相机本体。COM号、IP、bootId也不是持久相机身份。后续逐台配置须读取ESP本体MAC再绑定，不凭相同COM3认定是同一台相机。

本机私有核验记录：`cam/local/front-camera-verification.json`；配对配置：`cam/local/network-camera.json`。不在本登记表保存网络账号、配对密钥或图像。

## 前摄身份固件烧录完成

- 编译目标`camera-network-front`，仅写入0x10000应用区；esptool写后哈希验证成功。不写bootloader/分区，不擦NVS，原配对及校园网认证保留。
- 新应用SHA256：`ad48c286fa9ffad538700394e12f0c2aa3ffb9904d389c88e29cb1096480aaa5`。
- 高速全片读回失败，保留中断文件；随后115200低速完整读回0至0x110000，覆盖写入范围及原配置区，大小1114112字节。这不是完整16MB备份。
- 备份及烧录收据：`cam/local/front-identity-flash-receipt.json`；前摄独立密钥配置：`cam/local/network-camera-front.json`。后续左右摄不能复用/覆盖这些配置。
- 实测状态`portalOnline=true`；3张JPEG均640×480，哈希、会话、唯一ID、方向和递增序号验证通过；图像RAM-only，无模型调用。
- `network_stream.py`要求状态及每帧身份与配对配置一致，否则拒收。三摄并发及其他接收路径尚未验收。

## 左摄烧录完成

- 本体MAC：`14:c1:9f:c5:78:38`，唯一ID：`first-sight-3878c59fc114`，方向`left`，与前摄不同。
- 出厂已有DIO启动程序及factory应用分区（0x10000、大小0x100000），不是空白Flash。先完整备份0至0x110000（1114112字节），覆盖整个factory分区与配置区，非全片16MB备份。SHA256：`4dd0476f2da2284928220d214392ff174a8482a633b01f0fd4c99cc23c019481`。
- 编译`camera-network-left`，仅写应用区，esptool写后哈希验证通过；保留原启动程序/分区，未执行全片擦除。
- `pair_network_camera.py`现在必须显式指定role与camera-id，先核对串口启动身份再发送独立密钥及已有校园网凭据；不覆盖前摄配置。左摄私有配置为`cam/local/network-camera-left.json`。
- Wi-Fi认证状态`portalOnline=true`，3张640×480 JPEG序号0/1/2，逐张验证ID、left方向、boot、哈希、解码。前摄密钥访问左摄返回401，确认配对隔离。耗时812–2055ms，仅短测，不代表稳定2秒采样。
- 收据`cam/local/left-identity-flash-receipt.json`，原始备份`cam/local/pre-left-identity-20261025.bin`；图像RAM-only，无模型调用。

## 右摄烧录完成

- 本体MAC：`14:c1:9f:c6:4a:cc`，唯一ID：`first-sight-cc4ac69fc114`，方向`right`，与前/左不同。
- 原factory应用分区位于0x10000，大小0x100000。先备份0至0x110000，共1114112字节；非全片备份。备份SHA256与左摄相同（两板该范围出厂内容相同），本体身份仍以各自eFuse MAC判定。
- 编译`camera-network-right`，应用SHA256：`33f5fd37938194430f83074c94038c38ecca229d58aacefc19cf8390695257fd`；仅写0x10000应用区，写后哈希校验通过。未改启动程序/分区，未全片擦除。
- 独立配对配置`cam/local/network-camera-right.json`；前、左配置均未覆盖。Wi-Fi状态`portalOnline=true`，3张640×480图片序号0/1/2，逐张核对right方向、ID、boot、哈希与解码。单帧564–707ms，仅短测，不代表长期性能。
- 用前摄和左摄密钥访问右摄均返回401。收据`cam/local/right-identity-flash-receipt.json`，备份`cam/local/pre-right-identity-20261025.bin`。
- 三台逐台硬件验证完成；不等于已实现三路网页接入、同时供电/并发传输或曝光同步。图像仅RAM验证，无模型调用。

## 操作顺序

1. 每次只连接一台；读取本体唯一标识并与登记核对。
2. 前摄沿用已验证配置；确需更新固件时，先备份并保留配对数据，禁止常规全片擦除。
3. 用户确认更换下一台后，逐台配置左摄、右摄，使用各自身份和配对记录，不覆盖前摄配置。
4. 每台分别验证相机初始化、Wi-Fi状态和图像完整性；预览默认RAM-only，不启动记录或模型。
5. USB逐台验收不等于三摄同步或并发Wi-Fi验收，后续应单独验证。
