# 单摄串口接入：操作与实测

## 结论

- 已使用现有COM3固件接通：摄像头→串口→原图存档／收据→现有窗口调度→Qwen→Context／SQLite长期拓扑。
- 不刷固件、不改算法、不改模型提示／预算机制、调度和历史评分；只新增硬件输入和有界执行入口。
- **当前640×480、115200串口不满足每2秒一张。** 实际图片约25KB，8N1理论传输已约2.17秒，实测请求至收完约2.5秒。
- 保留2秒采样目标：前次尚未完成时不叠加请求，跳过已错过的固定时隙。因此当前测试实际约4秒一张；这不是声称摄像头只能4秒，而是当前不积压的整时隙策略。

## 模拟器基线核对

`run/inspect-repair-full90-v1/model-replay/observations.jsonl`同episode相邻观察中，831个间隔为2000ms，另有少量片尾短间隔。2秒是主要采样间隔，不是每2秒一次VLM。原窗口保持最小年龄10秒、启动间隔5秒、最多4观察，结束时flush。

## 新增文件

| 文件 | 职责 |
|---|---|
| `cam/stream.py` | 有界采集，保存JPEG与独立逐帧收据，坏帧／超时即停止，不自动跨未知复位续写 |
| `cam/run.ps1` | 并行启动独立采集进程与主机消费进程；采集不等待模型返回 |
| `src/hardware/camera-input.ts` | 路径／SHA256／时间／单摄契约校验，流式调度 |
| `src/hardware/run-camera.ts` | 原ContextLoop、Memory与VLM的主机执行入口，支持已录制和实时follow |

## 运行

在仓库根目录，先关闭其他串口工具：

```powershell
python -m venv cam/.venv
cam/.venv/Scripts/python.exe -m pip install -r cam/requirements.txt
npm run build

# 无模型调用：8张连续采集、传输和输入校验
powershell -NoProfile -ExecutionPolicy Bypass -File cam/run.ps1 -CaptureDirectory cam/local/check-001 -MemoryDirectory cam/local/check-input-001 -Count 8 -Interval 2

# 真实模型调用，需已配置QWEN_API_KEY和QWEN_BASE_URL
powershell -NoProfile -ExecutionPolicy Bypass -File cam/run.ps1 -CaptureDirectory cam/local/live-001 -MemoryDirectory cam/local/memory-001 -Count 30 -Interval 2 -ConfirmPaid
```

输出目录必须全新。默认COM3，可加`-Port COMx`。默认不调用模型；`-ConfirmPaid`模式每次最多512次HTTP请求、估算USD1（不是保证一定用完或达到上限），每事件16轮，与当前评测相同。短测实际远低于上限。

已采集数据可独立重放、提问，不重拍：

```powershell
node --use-env-proxy dist/current/hardware/run-camera.js cam/local/check-001 cam/local/replay-001 --confirm-paid "--question=当前可见哪些空间特征？不要猜测。"
```

问题在采集结束后基于最后一个实际观察回答，单独保存`questions.jsonl`；尚未提供实时交互UI或运行中插入问题接口。上下文不从旧数据库恢复，每次新运行使用独立SQLite。不要与模拟器旧记忆混写。

## 时间、原图与断线边界

- 当前固件无设备序号、曝光时间戳和传输校验和；收据使用主机序号／会话ID及SHA256，不冒称设备提供。
- `atMs`是主机发出采图请求的相对时间，**不是曝光时间**；另存主机接收时间、请求墙钟、耗时及`exposureTimeKnown=false`。未调用假设日历。
- JPEG按长度读取、检查头尾和结束符并完整解码；原图先存档，再写换行提交的收据。
- 单摄仅`frames:[实际前视图]`，侧摄缺失不填充、不复制、不用旧图补帧。
- 错过的时隙不伪造观察，日志和统计保留真实间隔；发生断线／坏帧停止，修复后另起新会话，不承诺自动重连或设备复位检测。
- 模型迟滞由磁盘收据缓冲，独立采集有帧数上限；消费端失败不会抹去采集原图。尚不是无限时长生产服务。
- 所有本地证据在`cam/local/`（忽略）；不得上传私人原图或含现场描述的模型输出。显式付费模式会将所需图像发送给已配置的模型服务。

## 本次实测

| 测试 | 结果 |
|---|---|
| 现有固件，目标2秒，12张 | 12完整JPEG，单张平均2503.5ms，最大2627ms；实际平均间隔4000ms；不达标 |
| 12张实际图回放到现有记忆 | 12观察／12归属，3窗口，无pending；产生1个候选地点，不代表地点正确性认证 |
| 最后一张真实图提问 | 完成最终回答并引用原图；未独立人审答案语义 |
| 串口采集与模型同时运行8张 | 8观察／8归属，2窗口，无pending；平均2534ms、最大2627ms，实际平均间隔4000ms |
| 模型实际调用 | 回放含提问4请求＋实时2请求；估算合计USD0.00447，unknown reservations为0 |

本地证据目录：`cam/local/cadence-2s-v1`、`integration-validate-v1`、`integration-model-v1`、`live-serial-v1`、`live-memory-v1`。未移动或替换正式90题证据。

## 达到2秒的下一步

当前串口带宽不足，主机收到后再缩图不能改善线缆传输。需要设备端减小JPEG，或同时提高固件及主机波特率（建议先试230400／460800，再独立检验稳定性）；均涉及固件更改和重新烧录，本次未做。Wi-Fi到位后替换采集源，仍沿用主机观察／记忆链；三路身份、采集时间同步和断线策略需另行验证。

测试命令：`cam/.venv/Scripts/python.exe -m unittest discover -s cam -p test_stream.py`（3项通过）；`npm test`（220项通过，包含硬件适配层与执行入口回归）。发布哈希／搬迁／旧冻结检查5项通过，文档链接检查通过。原模拟器／90题链完全保留，本次未重跑90题。
