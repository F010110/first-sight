# V2运行手册（Windows / 单摄 / 主动上传）

当前代码V2=v2.0.0，校园网主动上传基线＋记录switch与回放分段。移动断联未解决，不继续手机实验／跑路线；此手册用于恢复现有功能，不是重新开展硬件优化的授权。

## 环境与本地配置

- Node.js ≥22.13（本机Node24）及`npm ci`。
- `cam/.venv/Scripts/python.exe`，需安装`cam/requirements.txt`中依赖；根Python工具另用根requirements，不混用两个虚拟环境。
- 已装camera-network的ESP32-S3，相机实际单前视图；正常运行独立供电／校园Wi-Fi，不依赖USB数据线。
- 忽略的`cam/local/network-camera.json`含配对密钥，校园凭据已在用户批准下写NVS。密钥不写聊天、源码、APK、日志；NVS不是Flash加密。
- 模型使用环境变量`QWEN_API_KEY`、`QWEN_BASE_URL`，当前provider固定qwen3.8-flash、thinking关闭。仅预览／记录不会触发模型，但构造provider所需配置以当前服务实现为准。

## 每次启动

先查看电脑当前校园IPv4（不是设备IP、热点网关、VPN IP）：

```powershell
Get-NetIPAddress -AddressFamily IPv4
$env:CAMERA_TRANSPORT = 'push'
$env:CAMERA_RECEIVER_HOST = '电脑当前校园IPv4' # 必须替换
npm.cmd run realtime
```

`npm run realtime`本身不会设置这两个环境变量；缺少push会使用旧pull。服务只绑定本机8884，浏览器打开http://127.0.0.1:8884/realtime.html后首次状态请求启动Python接收器，8885绑定上述校园IP。网页未打开不代表8885已启动，这是回退基线的现有限制，不是自动守护服务。

已有服务时不要重复运行，EADDRINUSE不意味着需要杀掉任意进程。Windows重启或终端退出可能停止服务；当前没有开机自启／崩溃恢复。TS改动需重新构建并重启；静态HTML/CSS/JS刷新即可，记录中不要贸然重启。

## 电脑IP改变

当前不是固定地址方案。需同时更新服务环境变量和设备NVS中的上传地址；先退出该接收服务，确认新IP可绑定，再启动。设备更新需USB且会短暂复位：

```powershell
cam/.venv/Scripts/python.exe cam/configure_uplink.py --host 10.122.x.x
```

**现有基线脚本／固件USB配置命令只接受10.122前缀**，上例也必须替换为实际IPv4；电脑若被分到10.21等其他网段，不要照抄命令冒充可用，也不要擅自恢复已回退的热点配置器。该限制是待维护事项，当前不改固件。曾用后续实验固件写入过其他私有网段地址，不代表回退版配置器支持它。

## 用户模式

1. 默认仅预览：不保存画面；断流显示最后画面及年龄，不作为当前保证。
2. 开启“记录画面”：才存JPEG及准备后的PNG／SQLite，不调用模型。
3. 开启“系统启动”：自动包含记录，并进行空间分析；提交问题后运行只读问答。
4. 关闭系统：恢复手动记录选择；关闭记录不会关闭预览。
5. 打开http://127.0.0.1:8884/recordings.html：选择按开关分段的记录，已有页面用刷新按钮读取新内容；回放不调用模型。

空间／问题估算预算为0.50／0.25美元每小时，按接收会话计，不是实际账单；重启会话不是严格全局账户限额。默认不自动开始模型测试。

## 存储与取证

`run/realtime-system/<session UUID>/`内：`capture/frames/`为记录开启时的JPEG，`capture/observations.jsonl`为收据，`model-originals/`为像素等价PNG，`memory.sqlite`为原图／判断／问答，`live-events.jsonl`为开关等事件，模型请求目录保存响应／用量／失败。无事件文件的空预览会话不代表记录丢失。

回放片段ID是`session UUID~开启时间`，不是额外图像文件夹。判断和回答按可用时间显示，不能提前泄露未来结果；尾部可保留最后一图等待晚到结果。`replay-visibility.json`只过滤旧档案的可见性，不能当数据删除。

当前固件没有后加的持久诊断／USB历史接口，没有手机／公网／图像缓存补传。旧`run/network-diagnostics/`仍保留，但不能据此以为本版本还在持续收集完整设备错误。具体已知边界见[发布说明](../releases/v2.0.0.md)。

## 不触发付费调用的检查

```powershell
npm.cmd test
cam/.venv/Scripts/python.exe -m unittest discover -s cam -p test_push_stream.py
cam/.venv/Scripts/python.exe -m unittest discover -s cam -p test_network_stream.py
python scripts/check-doc-links.py
```

`scripts/check-compact-live-ui.cjs`使用mock API，不更改真实记录／模型模式；需本地Playwright与Chrome，依赖位置不写入项目。固件本轮不重刷，最近回退已构建／烧写校验。
