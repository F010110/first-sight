# 三摄Wi-Fi与光学匹配准备

## 状态与边界

- 已准备三摄ESP32固件（独立`camera-wifi`构建目标）、主机HTTP接收器、身份／会话／序号／校验与超时策略，以及现有Context输入适配。
- 固件编译通过；**没有烧录Wi-Fi固件，没有启动无线电，也没有真实三摄Wi-Fi实测**。当前设备仍保留可用的串口提速固件。
- 本地三个**合成图片**发送端→HTTP→观察输入端到端通过：3轮、9个实际上传、3组三视图，零模型调用。不冒充三个实机或空间算法测试。
- 未开放Windows防火墙，服务默认只绑定127.0.0.1。LAN绑定须显式`--allow-lan`，仅用于可信隔离局域网。当前HTTP明文，Bearer token不等于传输加密，不暴露公网。

## 数据流程与“同步”的准确含义

```text
主机发出2秒采集轮次
   ├─ cam-front → JPEG + bootId/sequence/驱动采集时间/SHA256
   ├─ cam-left  → JPEG + bootId/sequence/驱动采集时间/SHA256
   └─ cam-right → JPEG + bootId/sequence/驱动采集时间/SHA256
             ↓
逐图校验、原图和接收收据落盘
             ↓
完整且未过期的同轮次三视图 → 原窗口调度 → 原Context／SQLite
```

设备轮询`GET /v1/next/{cameraId}/{bootId}`，返回`WAIT`、`CAPTURE N`或`DONE`。上传`POST /v1/frame`，固定长度`image/jpeg`，上限300KB、640×480；请求头详见`src/wifi_transport.h`。认证头为`Authorization: Bearer ...`，不写日志。

- 主机拥有设备→前／左／右映射，不按到达顺序猜方向。
- 当前身份是预配ID＋共享token，不是设备证书或硬件认证；只适用于可信开发网络。
- 默认轮次2秒，截止1.5秒，三台设备的主机派发时间差最多250ms。超出时不组合。
- 这只是**主机采集请求对齐**。三台独立摄像头没有公共曝光时钟，驱动时间戳只保留为设备原始时间，`deviceClockAligned=false`、`exposureTimeKnown=false`。不能把网络到达时间接近称为同时曝光。
- 同轮缺任何一摄、过期、重复、倒序、损坏、设备重启换bootId，都拒收或拒绝组帧；不复用旧图、不复制其他摄像头补齐。已接纳的原图及缺帧／拒绝原因保留；非法或过期上传仅记拒绝日志，不额外保存其图片体。
- 严格三视图策略下，缺帧轮次不送模型，完成结果单独报告`missingRounds`。单摄串口路径仍可独立使用。
- 真实曝光对齐需要进一步测设备时钟偏移／漂移、曝光与驱动时间关系，必要时硬件触发；此原型尚未完成这些工作。

## 到货前可运行

```powershell
npm run build
cam/.venv/Scripts/python.exe -m pip install -r cam/requirements.txt
cam/.venv/Scripts/python.exe -m unittest discover -s cam -p "test_*.py"

# 自动生成临时token，运行三个合成发送端，接收并验证；无模型费用
cam/.venv/Scripts/python.exe cam/check_wifi.py cam/local/wifi-check-002
```

已完成记录在`cam/local/wifi-local-acceptance-v2/report.json`，逐图收据明确标记`sourceKind: synthetic-protocol-test`。这是纯协议测试；不能拿合成三图的结果给空间识别评分。

## 天线与三台设备到齐后

1. 先确认板子所需天线、频段、接头、供电与安装方式。未安装匹配天线前不启动Wi-Fi固件。
2. 将`wifi-config.example.h`复制到被忽略的`local/wifi-config.h`，分别配置实际SSID、密码、主机LAN地址、随机共享token，以及唯一设备ID `cam-front`／`cam-left`／`cam-right`。配置和编译产物均不提交。
3. 主机使用同一token配置环境变量`FIRST_SIGHT_CAMERA_TOKEN`（至少24字符）。例如可在PowerShell中生成：`$env:FIRST_SIGHT_CAMERA_TOKEN = (& python -c "import secrets; print(secrets.token_urlsafe(32))")`。只通过本地安全方式将该值写入三台设备配置，不打印到共享日志。
4. 显式编译`cam/.venv/Scripts/python.exe -m platformio run --project-dir cam -e camera-wifi`。默认`platformio run`仍只构建串口`camera`，防止误选目标。每台设备的配置／固件需分别归档其ID与hash。
5. 烧录前核验备份和当前分区；本次未自动烧录。不要用示例占位凭据直接部署。
6. 启动主机：

```powershell
cam/.venv/Scripts/python.exe cam/wifi_receiver.py cam/local/wifi-live-001 --host 0.0.0.0 --allow-lan --count 30
# 另一终端，先只验证：
node dist/current/hardware/run-camera.js cam/local/wifi-live-001 cam/local/wifi-input-001 --validate-only --follow
```

先做单台连通、三台完整率／延迟／偏移、丢包与断电重启测试，再显式批准模型接入。三摄曝光对齐未验证时，`--confirm-paid`默认会阻止Wi-Fi模型运行；如明确接受软同步实验风险，还必须加`--allow-unverified-sync`，该确认会写入运行计划，但不把曝光状态改成已验证。主机CPU／磁盘与模型延迟分别计量，默认不因摄像头来图而逐图调用VLM。

## 实际光学参数：哪些已知，哪些未知

| 项目 | 当前结论 |
|---|---|
| 输出尺寸 | 实拍已验证640×480，4:3 |
| 采样目标 | 单摄串口460800下已验证2秒 |
| 160° | 购买规格，未实测；水平／垂直／对角口径未知 |
| 投影、内参、畸变 | 未标定，不能仅凭一张房间图或OV2640型号推断 |
| 三摄安装角度／基线 | 未测，模拟暂用0／-90／+90度、同光心 |

配置在`cam/camera-profile.json`：真实字段仍`projection: unknown`、`measuredFovDegrees: null`、`hardwareCalibration: false`；仿真假设单独保存为**160°对角等距投影**，不是宣布实物就是这种镜头。

160°对角等距、640×480这一假设下，水平约128°、垂直约96°。若160°实际指水平，或实际为其他投影，结果会不同。因此不把160直接塞进水平FoV参数。

## 模拟器修改与实际渲染

新增`--hardware-profile`，保留原90°默认和旧数据。重新以足够广的视场渲染场景，再投影为640×480矩形等距近似；不从旧窄视角图片“补出”新视野，不凭空加圆形黑角。

```text
python -m sim render_side_views EPISODE --house HOUSE --output NEW-OUTPUT --windows 1 --hardware-profile cam/camera-profile.json
```

需要原WSL／THOR环境。实测`run/sim/hardware-vga-nominal160-v2`完成4个位姿、每个位姿3视图，共12张640×480图及拼图。不是旧学校851观察的重渲染：学校没有可用完整场景几何，不能改旧图视角后冒充新传感器采集。

初次3072源渲染因当前X显示器2560×1600限制失败，原目录`hardware-vga-nominal160-v1`保留。后用1536源图完成；`camera-model.json`记录约1.69倍中心上采样，因此只是硬件尺寸／广角敏感性预览，不是细节画质或算法分数验证。有更大虚拟显示环境后可用`--hardware-source-size 3072`提高源采样质量，或后续改多面渲染。

输出包含未标定声明、原配置、具体FoV口径、尺寸及源采样信息。原始姿态时间线保留；`requestedSampleIntervalMs=2000`只是硬件目标，不给旧动作编造2秒真实时间。当前同光心、静态场景逐视角重渲染也不等于三机硬件同步。

## 到货后标定准备

```powershell
# 无第三方依赖，生成9×6内角点、20mm方格SVG。按100%比例打印，实测方格边长。
python cam/calibrate.py board cam/local/checkerboard.svg

# 每个摄像头在当前640×480模式，分别采至少12张不同距离／倾角／位置的标定板照片
# 使用已装OpenCV的项目虚拟环境；明确选择模型，不自动宣布哪个正确
.venv/Scripts/python.exe cam/calibrate.py fit cam/local/calibration-front cam/local/front-fisheye.json --model fisheye
.venv/Scripts/python.exe cam/calibrate.py fit cam/local/calibration-front cam/local/front-pinhole.json --model pinhole
```

拟合工具检查尺寸、重复文件、有效角点数量及覆盖范围，记录原图hash、K／D／RMS；输出始终`fitted-needs-review`，不自动写成“160°已验证”或覆盖硬件profile。需要补独立重投影、边缘覆盖、FoV实测及三摄外参审核。当前没有标定板实拍，未宣称标定拟合已经通过实物验证。

## 回归与保留

两种固件构建目标均编译通过，未烧录；主机三路回环验收通过，无模型调用。Python主套件157项、硬件协议11项、TypeScript222项通过，包含三视图校验及未确认曝光同步时禁止付费运行的回归。旧串口12张归档在新输入层再次校验通过，文档链接检查通过。原核心算法、原90题输入和分数及正式版标签未改。
