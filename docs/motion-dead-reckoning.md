# 惯性速度估计（运动模块）

这份文档描述当前用于从手机传感器估算**局部米制速度**的模块。它回答的问题是“手机相对标定时刻的静止点在多快地移动”，**不是**世界坐标、绝对速度或可靠的长期轨迹。

代码：

- `src/dead-reckoning.ts`：核心估计器，纯函数，输入 `motion.jsonl` 的原始行，输出速度/位置时间线、标定信息和置信度。
- `src/motion-replay.ts`：离线验证入口，`npm run motion:replay -- <活动记录目录> [calibrationMs]`。
- `src/activity-motion.ts`：录制分析，用估计器的结果加强 `translationEvidence` 判定（速度数值本身不交给 VLM）。
- `web/app.js`：录制开始后前 3 秒作为校准窗，界面提示“保持手机静止”。

## 为什么需要“开头静止”

手机浏览器只能提供加速度（含/不含重力）、角速度和姿态，没有位置或速度读数。要对加速度积分得到速度，必须知道：

1. **初始速度**：假设标定窗内手机静止，初始速度 = 0。
2. **陀螺零偏**：静止窗内角速度的平均值，之后从所有角速度里减掉。
3. **重力方向**：静止窗内加速度（含重力）旋转到世界系后的均值，之后从世界系加速度里减掉。
4. **噪声底**：静止窗内残差的 RMS，用来设定零速检测的自适应阈值。

因此每次活动记录的最开始 3 秒必须保持手机静止。`capture.json` 的分析结果里会带 `motionCalibration.stable`，如果它不为真，说明开头并不够静止，速度估计应视为低置信度。

## 算法流程

```text
motion.jsonl（约 60Hz 加速度/角速度/姿态）
   ↓
解析并对齐：把最近一条姿态附到每条运动样本
   ↓
标定（前 3 秒）：陀螺零偏、世界系重力、加速度噪声、陀螺噪声
   ↓
逐样本：姿态 Z-X'-Y'' 旋转 → 世界系加速度 − 重力 → 去偏置
   ↓
梯形积分 → 速度；零速检测（ZUPT）时把速度归零
   ↓
速度 / 位置 / 路径 / 水平位移 / 逐点置信度
```

零速检测用滚动窗口（默认 500ms，需持续 300ms）判断：窗口内峰值角速度低于阈值，且加速度残差中位数低于阈值，就认为静止，把速度归零。阈值由标定噪声自适应：`max(4°/s, 5×陀螺噪声)` 和 `max(0.25 m/s², 4×加速度噪声)`。这是防止积分漂移无界增长的关键。

## 运动模式判定（启发式分析器）

`src/activity-motion.ts` 把传感器按 **2 秒窗**切片，再聚合成时间段。核心原则是**只认持续、连续的运动**，零散手抖不算。

**旋转按轴分离**：用融合姿态角计算，
- 偏航（yaw）= `alpha` 的逐帧变化累计；`yawPathDeg`/`yawNetDeg`/`yawCoherence = net/path`。
- 俯仰/横滚（tilt）= `beta`/`gamma` 的变化。
- 某窗口 `yawTurn` 当且仅当 `yawNetDeg ≥ 40° 且 yawCoherence ≥ 0.6`；相邻两个旋转窗之间的短暂停顿会**桥接**。因此"低头看一眼/歪手机"只算 `tilt`，不会当成转身。时间段的 `rotationAxis` 标注 `yaw / tilt / mixed / none`。

**平移要持续**：窗口需满足 `静止占比 ≤ 0.4 且 最大速度 ≥ 0.3 m/s`，并且连续窗口的**累计路径 ≥ 0.35m、时长 ≥ 3s** 才算 `translation_candidate`。平移与旋转**解耦**：边走边转时两者都会报告。
- 方向：用**不依赖积分漂移**的方法——把水平加速度投影到"手机背面朝向（前）"与"手机右侧（侧向）"两个轴，看能量占比。前向能量主导 → `forward`；侧向主导 → `left/right`；介于两者之间（大幅转身时）→ `mixed`。前后符号受积分漂移影响不可靠，因此前向主导时统一报 `forward`。
- 速度：按平均速度分 `slow(<0.4) / moderate(0.4–0.9) / fast(>0.9) m/s`。

**模式（5 种）**：`rotation_dominant`、`translation_candidate`、`stationary_jitter_candidate`、`low_motion`、`mixed_or_unknown`；同时输出 `viewHeadingChange / translationEvidence / motionVariance / rotationAxis / translationDirection / speed`。大角度快转优先判为 `rotation_dominant`，其余有持续位移判 `translation_candidate`。

### 双事件流

除逐段时间线外，分析结果还输出两条独立的事件流：

- `translationSpans`：持续位移段（起止、方向、速度档、累计路程、净位移）。判定以**累计路程**为准：一段路程 ≥ 1.5m 才算"行动"。
- `turnEvents`：每次转向事件（起止、**净角度**、方向、**是否原地**）。`inPlace` 按该次转向期间累计路程是否够 1.5m 判断。

之所以用"路程"而不是"净位移"：IMU 单独双积分时，净位移对姿态/零偏/初速误差极其敏感（方向漂移会让轨迹打转），而累计路程单调累加、相对可信。净位移仍记录在 `translationSpans` 里，但不作为判定依据。

这样"走动"和"转向"不再互相吞并：一段持续位移里可以叠加多次不同幅度的转向事件；原地转圈会作为 `inPlace=true` 的独立事件列出。

### 实时接入（试用服务）

浏览器保留最近 **10 秒**原始 IMU，并在触发一次观察时随请求发送 `motionSamples` + `motionCalibration`（会话开始 3 秒静止时算好的重力/零偏）。服务端用 `summarizeRealtimeMotion` 产出 `MOTION` 报告，并：

- 注入 VLM 提示词（`MOTION:` 一段，含 action/turn/heading 与"仅为近似提示"的约束）；
- 派生 frame-gate 的帧预算：`action`→位置显著、`turn`→朝向显著、运动中转向→行进方向显著，再合成 `still/ordered/irregular`。

节奏：**自动观察每 10 秒最多一次**；Quiet 只在运动状态变化或转向时触发，Awareness/Task 每 10 秒定时触发。原地转向与"运动状态变化"各触发一次观察。

每次观察都默认把原始 IMU 与标定保存到 `run/experiments/<session>/inputs/<runId>/motion.json`（帧同目录），因此之后可以对着保存的记录重新分析/重新推理，不需要单独的录制流程。

## 实测结果（2026-10-03 受控记录，30 秒）

记录 `a10f9310-.../activity-recordings/01329479-...`，动作脚本为"静止 → 向前走几步 → 原地转身 → 无规则轻微摇晃"：

| 时间 | 判定 | 对应动作 |
|---|---|---|
| 0–6s | `low_motion` | 静止（校准） |
| 6–8s | `stationary_jitter_candidate` | 起步前轻微晃动 |
| 8–14s | `translation_candidate`，dir=forward，speed=slow | 向前走 |
| 14–22s | `rotation_dominant`，axis=yaw | 原地转身 |
| 22–30s | `stationary_jitter_candidate` | 无规则轻微摇晃 |

对比早期朴素积分：同一类记录里净水平位移从 ~1.5m 漂移压到 ~0.24m；早期把摇晃误判为旋转的问题，在按轴分离 + 方向一致性门槛后已消除。

## 已知限制

- 偏航（`alpha`）是相对的，路径方向没有绝对参考；只有速度大小和相对位移有意义。
- 长时间连续运动、没有静止间隙时，积分漂移仍会累积，`trajectorySummary.notes` 会提示。
- 标定窗不静止时，`calibration.stable=false`，结果置信度为低。
- 要验证“平移检测”，需要一段受控记录：**静止 5 秒 → 向前/侧向走几步 → 停 3 秒 → 原地转身 → 停**。

## 后续可选方向

- 在录制开始时把浏览器端算出的标定（重力、零偏）随 `recordings/start` 一起上传，避免离线再猜标定窗。
- 把在线 Router 的 `integrateLinearMotion` 换成同样的“标定 + ZUPT”估计，让 Quiet/Awareness 的帧预算也用上真实速度。
- 若需要可靠的长距离轨迹，考虑高频相机帧 + IMU 的 VIO（见会话中的讨论），但这超出当前每秒一帧的采集。
