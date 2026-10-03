# 第一视角视觉助理试验环境

产品方向与分阶段计划见 [产品设计文档](docs/product-design.md)，当前软件分层见 [Agent 架构](docs/architecture.md)，运动速度估计见 [惯性速度估计](docs/motion-dead-reckoning.md)；原始项目材料保存在 [docs/references/](docs/references/)。当前试用版支持手机摄像头、截图缓存、Qwen 多帧分析、目标问题、持续任务状态、事件驱动观察和人工反馈；它仍是供迭代测试的原型，不提供可靠的安全导航能力。

Python 工具位于 `scripts/`，保留离线抽帧和逐图识别基线；Pi Agent Core 与 Qwen 负责视觉感知，帧门控、工作记忆和注意力策略独立运行。手机浏览器可用时，事件 Router 根据 IMU 最近 8 秒的累计姿态与加速度路径估计位置、摄像头朝向和行进方向是否显著变化；画面签名只用于多帧稳定/变化防抖，不参与运动分类。原始传感器读数保存在实验记录中用于复盘；VLM 只接收三个维度的“无显著变化 / 显著变化 / 未知”状态，不接收速度、角度、方向向量或原始轨迹。位置与路径状态是低置信度相对估计，不是绝对位移；匀速运动仍可能无法判断；未读到传感器数据时标为未知，不使用深度图或 3D 地图。

## 项目结构

- `src/`：TypeScript VLM Harness、手机试用服务和实验记录工具
- `web/`：手机网页界面
- `scripts/`：视频抽帧与 Python 图片识别工具
- `examples/`：可复制修改的测试案例模板
- `docs/`：产品设计与原始参考材料
- `reference-code/`：Vinci、IT3DEgo 和 Embodied VideoAgent 上游代码的本地只读参考副本；物理空间方案比较见 [空间定位参考](docs/references/spatial-reference-review.md)，Vinci 检查结论见 [代码评估](docs/references/vinci-review.md)。该目录已加入忽略列表
- `run/`、`datasets/`：本地实验记录和数据目录，保留在项目根目录

## 数据建议

优先使用 [EPIC-KITCHENS-100](https://epic-kitchens.github.io/2026)：它提供头戴相机拍摄的第一视角日常厨房视频和动作/物体标注。首轮选一个视频，取前 5 分钟以内的节选即可；它以厨房为主，适合先跑通流程，不能代表所有日常场景。完整数据较大，且数据集许可为非商业研究用途。

官方提供的下载工具支持按视频 ID 选择下载，说明见 [下载脚本说明](https://github.com/epic-kitchens/epic-kitchens-download-scripts)。也可以先用已有的本地 MP4，不必为验证程序一次下载整套数据。

## 配置

环境中需配置：

- `QWEN_API_KEY`
- `QWEN_BASE_URL`：Qwen 的 OpenAI 兼容接口 base URL
- 可选 `QWEN_MODEL`：默认 `qwen3-vl-plus`

安装依赖：

```powershell
python -m pip install -r requirements.txt
```

## 运行流程

### 1. 从最多 5 分钟视频节选中抽帧

默认每 5 秒抽一张，最多生成 60 张：

```powershell
python .\scripts\extract_frames.py .\sample.mp4 --duration 300 --interval 5 --output-dir .\frames
```

想按用户建议每秒抽一张时，将 `--interval 5` 改为 `--interval 1`。`--start` 可指定节选起点；`--duration` 上限为 300 秒。为避免把旧帧混进本轮结果，输出目录需要是新的或空的。

### 2. 用 Qwen 分析截图

默认从整个截图序列均匀选最多 12 张，控制首轮 API 调用量；`--max-images 0` 会分析全部截图：

```powershell
python .\scripts\analyze_frames.py .\frames --goal "帮我找到水杯" --output-dir .\observations
```

每张被选中的截图单独调用一次 Qwen，输出 JSON 文件，包含场景、室内/室外、主要物体和位置、可读文字、不确定项及可选的 `user_tip`。提供用户目标时，只在画面能直接帮助该目标时提示；未提供目标时通常返回 `null`，仅提示明确且紧急的安全风险。汇总清单写到 `observations/manifest.json`。

也可以单独分析一张截图：

```powershell
python .\scripts\scene_reader.py .\frames\frame_000000.jpg --goal "帮我找到水杯"
```

## 首轮评估

先人工给被选截图标注场景类型、关键物体和大致位置，再检查 Qwen 输出是否正确；单独记录错误识别、无依据的提示和应该提示却返回 `null` 的情况。建议先用默认的每 5 秒抽帧和 12 张上限跑通，再根据结果决定是否提升到每秒抽帧或增加截图数。

## 可迭代的 VLM Harness

Pi Agent Core 负责图像消息与模型调用，Qwen 通过 `pi-ai` 的 OpenAI-compatible provider 接入。模型输出场景值、场景是否变化及两者各自的置信度、观察事实、证据帧和可选候选措辞；代码根据注意力模式、任务相关性和证据决定回答、主动提示或沉默。`quiet / awareness / task / explore` 是注意力模式，`economy / deep` 是推理预算，彼此独立。回答至少需要有达到置信度阈值且带证据帧的观察；默认阈值为 0.65，可通过 `VLM_ANSWER_CONFIDENCE_THRESHOLD` 调整。

每次运行写入 `run/experiments/<session-id>/runs.jsonl`，并复制输入截图到该 session 下，保证后续复跑有固定视觉输入。记录包含图片 SHA-256、来源路径、目标、帧门控取舍、逐帧运动状态摘要、注意力模式、推理预算、模型与 prompt 版本、模型原始响应、结构化观察、策略决定、延迟、错误和可选人工期望标签。API key 不写入记录。人工反馈以追加式 `feedback.jsonl` 保存，包含识图、应答决策、回答正确性和帮助程度。

用单个目录末尾 4 张图运行：

```powershell
npm.cmd run harness:sample -- .\run\frames --goal "帮我找蓝色盖子的容器" --count 4 --session blue-lid-v1 --profile baseline
```

准备同一批测试案例并对不同配置分别运行时，复制并编辑 [examples/cases.example.json](examples/cases.example.json)：

```powershell
npm.cmd run harness:cases -- --cases .\examples\cases.example.json --session qwen-plus-v1 --profile baseline
npm.cmd run harness:cases -- --cases .\examples\cases.example.json --session qwen-other-v1 --profile alternate-model --model "另一个可用模型名"
$env:VLM_ANSWER_CONFIDENCE_THRESHOLD = "0.75"
npm.cmd run harness:cases -- --cases .\examples\cases.example.json --session qwen-plus-075 --profile high-confidence-threshold
```

案例 JSON 是数组；每项包含稳定的 `caseId`、`goal`、帧的 `id/path/timestampMs`。可选 `expected` 标签支持 `decision`、`targetFound`、`positionCorrect`。图片路径相对案例文件解析。`targetFound` 自动指标按“是否有带证据帧的 goal-relevant 观察”计算；方位准确度保留为人工标签，因为不能仅靠输出是否有方位文字代表位置正确。

对某条运行记录添加人工判断（查看该 session 的 `runs.jsonl` 获取 runId）：

```powershell
npm.cmd run harness:feedback -- --session qwen-plus-v1 --run-id <runId> --useful true --perception-correct true --position-correct false --decision-correct true --response-correct false --notes "找到物体但左右关系错误"
```

汇总一个 session，或按 `caseId` 比较多种模型/提示配置：

```powershell
npm.cmd run harness:summary -- --session qwen-plus-v1
npm.cmd run harness:summary -- --sessions qwen-plus-v1,qwen-other-v1 --out .\run\experiments\comparison.json
```

需配置 `QWEN_API_KEY` 和 `QWEN_BASE_URL`；可选 `QWEN_MODEL` 覆盖默认 `qwen3-vl-plus`。不同 profile、模型、endpoint 或阈值使用不同 session ID；复用已有 session 时配置不匹配会报错。`runs.jsonl` 和 `feedback.jsonl` 是追加记录，修正标注时再追加一条反馈即可，汇总会合并同一 run 的反馈字段并保留最新非空标注。

## 手机摄像头体验

启动带口令的本机网页服务：

```powershell
$env:VLM_TRIAL_PASSCODE = "设置一个至少 3 位的临时口令"
npm.cmd run trial:web
```

在电脑浏览器打开 `http://localhost:8765` 可先检查界面。手机浏览器的摄像头 API 要求 HTTPS；扫码体验时，用临时 HTTPS 隧道转发到 `http://localhost:8765`，再用电脑浏览器将隧道网址生成二维码。服务默认只监听本机回环地址，Qwen key 仅在服务端使用。忘记设置口令时，服务会生成并在终端显示一个随机体验口令。

网页提供 Quiet、Awareness、Task、Explore 四个模式按钮，并支持后置摄像头实时预览和手动抓拍。用户开启摄像头并授权后，默认进入 Quiet，浏览器固定每秒抓拍一张并在本地保留最近 32 帧；截图频率与 VLM 调用频率分开。近乎静止时 Quiet 和 Awareness 每次只向服务端发送一张截图；位置、朝向或行进方向出现一个显著变化时最多分别发送 3/4 帧，多个维度同时变化或运动方向明显不稳定时最多发送 5/6 帧。运动摘要来自最近 8 秒的累计姿态范围、净转动/累计转动、净位移估计/总路径比例和加速度方差；短时往复抖动不会单独触发变化状态。相似度指标只在最近 5 帧中至少 3 帧持续变化时参与路由防抖，不用于推断平移或运动方向。IMU 积分仍会漂移，位置和行进方向可能标为未知或低置信度。Quiet 只静默更新场景，不因普通视野变化播报。Awareness 活跃期间每 15 秒复查关注条件；普通变化和疑似事件也可额外触发观察。浏览器若要求运动传感器权限，会在开启摄像头时请求；运动摘要单独不代表场景变化。Task 会先用深度预算回答，随后用节省预算观察目标；Explore 单次分析当前画面。

摄像头画面在浏览器中是实时视频，发给 Qwen 的仍是触发时选出的截图，而非连续视频流。浏览器计算截图清晰度、曝光、低分辨率画面签名和传感器运动摘要，先合并近重复帧，再按质量、时间覆盖和运动证据抽取最多 8 帧；服务端统一使用同一运动类别决定预算：Quiet 为 1/3/5 帧，Awareness 为 1/4/6 帧，Task/Explore 上限为 4/8 帧。静止帧预算为 1，有序运动和无规则运动分别增加。Quiet 会在首次稳定画面和稳定变化后更新场景，没有固定间隔的 Qwen 调用，也不会因普通视野变化提示用户；近乎相同的已见视角会命中本地签名缓存而跳过重复调用。Awareness 活跃时每 15 秒复查关注条件。输入框可填写用户想找的目标，也可通过“关注这个情况”启动 Watch：未发生时保持安静，疑似发生后用新截图复核，确认后提示一次。找物 Task 会记录搜索进度，在主动请求但证据不足时提示改善视角；本 session 中最多保留 4 张对象/文字关键帧，相关任务可调入一张历史画面。高优先级安全事件仍没有独立低延迟检测通路。Task、Watch 事件和每次 Router 触发摘要分别保存在 `events.jsonl`、`runs.jsonl` 中；结果与人工反馈保存在 `run/experiments/<session-id>/`。

页面另有一次性“记录一段活动”流程，可选 30 秒、1 分钟、3 分钟或 5 分钟。记录期间每秒保存 JPEG，并把浏览器实际收到的加速度、角速度、姿态读数每 10 帧左右分批上传；这一流程会暂停自动 VLM 观察，并在停止时关闭摄像头。结束后可单独请求一次整段分析；VLM 最多看 8 张均匀抽取的代表帧及其位置、摄像头朝向和行进方向不变量摘要，原始截图和运动事件仍完整留档，便于后续离线检查。数据位于 `run/experiments/<session-id>/activity-recordings/<recording-id>/`：`capture.json` 是清单与传感器诊断，`frames.jsonl`/`motion.jsonl` 是时间戳索引，`frame-*.jpg` 是原图。浏览器 IMU 记录的是加速度、角速度和姿态，不能直接测得绝对位移；位移积分估算会累积漂移。
