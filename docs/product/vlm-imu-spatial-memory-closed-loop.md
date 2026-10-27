# VLM—惯性—双层空间记忆闭环：项目实施计划

状态：2026-10-27 起草。工程闭环设计，不是论文新颖性声明，也不是实验成绩。
适用代码：当前 First Sight 仓库（TypeScript 主链路 + 外部定位适配器）。
关联文献核查：`research/reports/spatial-memory-paper-code-audit.md`。该报告只用于确认已有工作和缺项，不把外部项目当作本项目依赖。

## 0. 一句话目标

在现有 First Sight 代码上跑通下面这条链，并能重复回放、重启后恢复：

```text
RGB 图像 + 原始 IMU
  → 带时间、坐标系、协方差/质量标记的运动证据
  → VLM 地点/关系/重定位/导航提议
  → 确定性写入门禁
  → 短期工作记忆 + 长期地点图
  → 重访与长期重定位
  → 语义目标导航
```

**完成标准是“工程上能跑、可审计、失败可复现”，不是“超过某篇论文”或“证明新算法”。**

## 1. 项目边界

先明确不做什么，避免把项目闭环误写成科研结论。

- 不训练新 VLM，不部署本地大模型；继续使用 `QWEN_API_KEY` / `QWEN_BASE_URL` 指向的 API。
- 不把当前工作包装成论文复现；外部方法只作对照和设计参考。
- 不以物体级 3D 重建为中心；以地点、拓扑、路径、朝向和自身运动为中心。
- 不把动作历史、VIO 位姿、原始 IMU、运动 token 混为一类。
- 不把 GT 位姿、GT 地点 ID、navmesh 或评测答案送入运行时。
- 不先上实机；先在已有录制和仿真回放中闭环。
- 不在闭环未稳定前启动新训练、大规模实验或替换定位算法。
- 不删除原始观测来“修正”记忆；修正必须留下版本和证据。

## 2. 现状与缺口

### 2.1 已有可复用资产

| 资产 | 位置 | 目前作用 | 本项目如何使用 |
|---|---|---|---|
| 地点拓扑服务 | `src/agent/spatial-topology-service.ts` | 观测→地点分配、窗口识别、merge/split/confirm/undo、边 | 作为长期地点图的基线，不另起一套图 |
| SQLite 空间存储 | `src/agent/spatial-sqlite-store.ts` | observations、places、assignments、visits、transitions、revisions | 扩展运动证据、假设和重定位记录；保留事务与版本 |
| 短期工作上下文 | `src/agent/spatial-working-context.ts` | 当前观测、最近判断、地点 anchor、检索证据、容量上限 | 扩展运动证据与未决提议；仍只做有界视图 |
| 经历图 | `src/agent/experience-graph.ts` | 原始观测、视觉节点、访问顺序、revision | 保留为可审计的原始经历层，不把它冒充地点图 |
| VLM 地点识别 | `src/agent/spatial-topology-vlm.ts` | Qwen 多图地点判断与严格 JSON 解析 | 复用调用/重试/审计模式，加入运动证据输入 |
| IMU 航位推算 | `src/dead-reckoning.ts` | 约 60 Hz 浏览器 IMU，静态校准、ZUPT、局部轨迹 | 作为第一版 raw-IMU 证据来源；明确不是全局定位 |
| 实时运动摘要 | `src/realtime-motion.ts` | 10 秒窗口的平移/转向事件与可靠性 | 作为 VLM 的紧凑运动摘要，不替代原始测量 |
| 离线 VIO | 现有 OpenVINS 工作区与导出 | 真实图像 VIO 试跑 | 作为独立 `vio` 证据来源，与 raw IMU 分列 |
| 回放与证据 | `src/motion-replay.ts`、`run/` | 录制回放、manifest、原始输出 | 建立闭环 fixture 与可重复运行 |

### 2.2 当前缺口

1. 没有统一的 `MotionEvidence` 契约：现有运动摘要没有协方差、bias、时间跨度、坐标系和来源等级。
2. VLM 还没有稳定收到“带不确定性的惯性证据”；现有地点识别主要是图像＋历史地点。
3. VLM 输出与 SQLite 写入之间缺少专门的运动/因果/冲突门禁。
4. 没有“候选地点→VLM 核验→接受/拒绝/待定→revision”的重定位闭环。
5. 没有从语义目标到拓扑路径再到仿真 waypoint 的可运行导航执行器。
6. 没有跨进程重启后仍能回答“上次在哪里见过”的端到端 fixture。
7. 现有 IMU 摘要、VIO 位姿和动作历史容易在文档里被混称；本计划强制分字段。

## 3. 目标数据流

```text
                    ┌─────────────────────────────┐
RGB frames ────────►│ Observation                  │
raw IMU ───────────►│  id / time / frames / source │
timestamps ────────►└──────────────┬──────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │ Estimator adapter            │
                    │  raw IMU → 预积分/航位推算   │
                    │  optional VIO → pose+cov     │
                    │  GT only in eval artifact    │
                    └──────────────┬──────────────┘
                                   │ MotionEvidence
                    ┌──────────────▼──────────────┐
                    │ Evidence builder             │
                    │  当前帧 + 最近地点 + anchors │
                    │  活跃运动 + 未决假设          │
                    └──────────────┬──────────────┘
                                   │ bounded context
                    ┌──────────────▼──────────────┐
                    │ VLM proposer (Qwen API)      │
                    │  地点同一性 / 关系 / 重定位  │
                    │  导航意图 / 不确定性 / 拒答  │
                    └──────────────┬──────────────┘
                                   │ proposal (no direct DB write)
                    ┌──────────────▼──────────────┐
                    │ Deterministic write gate     │
                    │  schema / 因果 / 坐标 / 协方差│
                    │  ID 白名单 / 冲突 / 预算      │
                    └──────────────┬──────────────┘
                                   │ accept / uncertain / reject
                    ┌──────────────▼──────────────┐
                    │ Memory commit                │
                    │  short-term working context  │
                    │  long-term SQLite place graph │
                    │  revisions + raw evidence    │
                    └──────────────┬──────────────┘
                                   │
          ┌────────────────────────┼────────────────────────┐
          ▼                        ▼                        ▼
   地点检索/重访            长期重定位                 语义目标导航
```

关键原则：**VLM 提议，程序提交。** VLM 不能直接写数据库，不能发明未提供的 ID，不能把“不确定”改写成事实。

## 4. 数据契约

### 4.1 Observation

```ts
interface LoopObservation {
  id: string;
  atMs: number;
  frames: Array<{ path: string; cameraId: string; atMs: number }>;
  recordingId: string;
  source: "live" | "replay" | "sim";
}
```

要求：

- 每帧有真实时间；多摄不能共用一个虚构时刻。
- 图像路径只指向原始文件或只读归档；不覆盖原图。
- 运行时数据不得包含 GT 地点、GT 位姿、对象 ID 或参考答案。
- 观测入队后按时间单调；乱序直接拒绝并保留失败证据。

### 4.2 MotionEvidence

这是本项目新增的核心契约。它不是“动作历史”，也不是笼统的 pose。

```ts
type MotionSource = "raw_imu_preintegration" | "vio" | "pose_gt" | "action_history";

interface MotionEvidence {
  id: string;
  startMs: number;
  endMs: number;
  observationIds: string[];

  source: MotionSource;
  frame: "world" | "local_start" | "camera";
  delta: {
    dx: number;
    dy: number;
    dyaw: number;
  };

  // Row-major 3x3 covariance for [dx, dy, dyaw].
  // null means unavailable; never fill with a made-up variance.
  covariance: number[] | null;

  bias: {
    gyroDps?: [number, number, number];
    accelMps2?: [number, number, number];
  } | null;

  stationary: boolean;
  quality: "high" | "medium" | "low" | "unknown";
  qualityReason: string;
  rawRef: string | null;
}
```

硬约束：

- `source="raw_imu_preintegration"` 才能称为原始 IMU 证据；`vio` 单独标注。
- `pose_gt` 只允许出现在评测产物里，运行时必须拒绝。
- `action_history` 只表示已执行动作，不表示物理位移。
- 没有协方差就写 `null` 和 `quality="unknown"`；不能用一个手调 sigma 冒充标定协方差。
- 每条证据必须能回到原始 IMU/位姿文件和代码版本。

### 4.3 VLM 输出

VLM 只输出提议，不输出数据库操作结果。第一版采用严格 JSON：

```json
{
  "schemaVersion": 1,
  "observationId": "obs-...",
  "citedObservationIds": ["obs-..."],
  "citedMotionIds": ["motion-..."],
  "place": {
    "decision": "same | new | uncertain",
    "candidateId": "place-id-or-null",
    "confidence": 0.0,
    "reason": "可见证据 + 运动证据"
  },
  "relations": [
    {
      "type": "adjacent | across_boundary | contains | unknown",
      "targetPlaceId": "place-id",
      "evidence": "证据",
      "confidence": 0.0
    }
  ],
  "relocalization": {
    "decision": "accept | reject | uncertain",
    "candidatePlaceId": "place-id-or-null",
    "reason": "外观/结构/运动一致性",
    "confidence": 0.0
  },
  "navigation": {
    "goalPlaceId": "place-id-or-null",
    "intent": "go_to | return_to | inspect | stop | unknown",
    "reason": "证据"
  },
  "memoryOps": [
    {
      "type": "propose_edge | propose_alias | flag_conflict",
      "fromPlaceId": "place-id",
      "toPlaceId": "place-id",
      "reason": "证据"
    }
  ],
  "abstain": false
}
```

如果一次调用同时要求地点、重定位和导航导致输出不稳定，可拆成两次调用：一次只做地点/关系，一次只做重定位/导航；两次必须共享同一组证据并按同一预算记录。不要用一段自由文本代替可验证 JSON。

门禁必须检查：

- `observationId` 存在且是当前批次；`citedObservationIds` 只能引用已投喂的因果证据。
- `citedMotionIds` 只能引用本次上下文的运动证据；没有引用则不能声称使用了惯性信息。
- `candidateId`/`targetPlaceId` 只能来自提供的候选集或 `new` 临时 ID。
- `abstain=true` 时不允许任何写操作。
- 输出非法 JSON 时最多一次协议修复；仍失败则记录失败并保持记忆不变。

## 5. 双层空间记忆

### 5.1 短期工作记忆

复用并扩展现有 `SpatialWorkingContext`：

- 当前观测；
- 最近 6 条地点判断；
- 最多 4 个地点 anchor；
- 最近检索到的 4 条证据；
- 当前活跃的 `MotionEvidence`；
- 尚未提交的地点假设/重定位提议；
- 冲突提示。

约束：

- 默认 60 秒滑动窗口，容量有上限；不把全历史塞进 prompt。
- 短期内容只是视图，不替代长期原始记录。
- 未决假设可以留在短期层；不得因为“看起来像”直接升级为长期地点。
- 当前地点未知时，不能沿用上一帧地点冒充当前位置。

### 5.2 长期记忆

以现有 SQLite 为持久层，保留原始观测和 revisions。建议新增/扩展：

| 表 | 作用 | 关键约束 |
|---|---|---|
| `observations` | 原始观测索引 | 不覆盖；保留 raw/hash |
| `places` | 地点节点、摘要、状态 | 不物理删除；retired 只隐藏 |
| `assignments` | 观测到地点的关联 | 可 reassess，保留原关联 |
| `visits` | 每次到访区间 | 跨会话保留 |
| `transitions` | 地点间已观察到的转移 | 不能凭语义相似自动生成可导航边 |
| `revisions` | merge/split/confirm/undo | 记录 before/after 和证据 |
| `motion_evidence` | 运动证据、协方差、来源 | 与观测多对多；不可改写 |
| `place_hypotheses` | VLM 的待定地点假设 | `proposed/supported/rejected` |
| `relocalizations` | 候选、分数、决定、证据 | 可回溯每次接受/拒绝 |

迁移要求：

- 现有 schema 为 1；新增字段/表升级到 2，并提供幂等迁移。
- 旧库必须能打开、读取、备份后再迁移；迁移失败不得丢原数据。
- 所有写入在一个事务内完成；批量提交必须匹配 pending 前缀。
- 长期记忆保存的是地点、访问、边和证据，不是“把聊天摘要当地图”。

### 5.3 谁负责什么

| 动作 | VLM | 程序/门禁 | 估计器 |
|---|---|---|---|
| 创建地点 | 提议“新地点”、名称/摘要、证据 | 校验 ID、时间、图像引用后提交 | 只提供运动证据 |
| 关联到旧地点 | 提议 `same`/`known` 及候选 | 检查候选存在、因果、冲突 | 不参与语义决定 |
| 更新摘要/代表图 | 提议新摘要 | 保留旧代表和原观测，限额替换 | 不参与 |
| 合并 | 提议同一地点及理由 | 要求地点契约、证据、无正面冲突；写 revision | 不参与 |
| 拆分 | 提议冲突/不同地点 | 要求正面不相容证据；保留 aliases 和路径 | 不参与 |
| 纠错/撤销 | 可指出冲突 | 执行可逆 revision；不能删除原件 | 不参与 |
| 重定位 | 核验候选、给出接受/拒绝/待定 | 视觉＋运动一致性门禁；记录决定 | 提供 pose/covariance |
| 导航 | 选择目标地点/意图 | 只在已有边上规划；执行器落地 | 提供当前位姿 |

明确：**语义标注不是空间推理。** 若 VLM 只给图像打标签，不能声称它完成了地点同一性或路径推理。

## 6. 不确定性如何进入 VLM

### 6.1 两条证据链，禁止混名

1. **raw IMU 链**
   - 原始角速度/比力 → 静态校准（bias、重力、噪声）→ 预积分/航位推算 → `delta` + `covariance` + `quality`。
   - 第一版可复用 `src/dead-reckoning.ts` 的局部轨迹；协方差若暂不可用则明确写 `null`，先做质量门控。
2. **VIO 链**
   - 图像＋IMU → OpenVINS 或现有 VIO → 位姿/协方差 → `source="vio"`。
   - 它可以用于重定位和轨迹一致性核验，但不能被称为 raw IMU 进入 VLM。

两条链可以同时进入上下文，但必须分字段、分来源、分置信度。

**第一版的“VLM 使用惯性”是结构化证据注入，不是训练一个传感器编码器。** 它能让项目闭环并验证记忆/门禁，但不能宣称已经实现 learned IMU-VLM fusion；后者属于 P6，需另立协议。即使如此，VLM 也必须明确收到并引用运动证据，不能只是在前端定位后把 pose 当作普通图片元数据。

### 6.2 VLM 看到的运动摘要

不把几百行 IMU 原样塞进 prompt。给 VLM 的应是紧凑、可引用、带不确定性的摘要，例如：

```json
{
  "id": "motion-...",
  "source": "raw_imu_preintegration",
  "windowMs": 4200,
  "delta": {"dx": 1.8, "dy": 0.4, "dyaw": -12.0},
  "sigma": {"xyM": 0.35, "yawDeg": 4.0},
  "stationary": false,
  "quality": "medium",
  "qualityReason": "static calibration stable; 2 gaps under 200 ms",
  "caveat": "local displacement, not absolute position"
}
```

VLM 必须被明确告知：

- 这是局部运动证据，不是全局坐标；
- `sigma`/`quality` 是证据强度，不是装饰；
- 画面变化不等于用户转身，运动证据也不能单独证明地点相同；
- 没有足够证据时必须 `uncertain`/`abstain`。

### 6.3 程序侧一致性门禁

只在证据可用时做，不能凭空增加精度：

- 时间：`startMs/endMs` 必须覆盖观测窗口；时间倒序或断档超限 → 拒绝更新。
- 坐标：`frame` 必须与当前地点图坐标系一致；不一致 → 只作局部证据，不写全局边。
- 位移：短窗口内大位移但地点声称 `same`，且没有连续观测 → 降为 `uncertain`。
- 转向：大角度 yaw 变化但没有任何新视角 → 不允许静默合并。
- 协方差：可用时可用 Mahalanobis 距离做软门禁；不可用时只用质量等级，不伪造数值。
- 冲突：正面不相容证据优先于相似度；冲突进入 `place_hypotheses`，不直接覆盖旧地点。

阈值只能在开发 fixture 上定一次，测试前冻结；不能按测试题调参。

## 7. 分阶段实施

每个阶段都必须留下 manifest、原始输出、失败日志和可重跑命令。上一阶段未通过，不进入下一阶段。

### P0：契约与 fixture（不调用模型）

工作：

- 固定一个 5–10 分钟回放片段：至少 3 个地点、一次重访、直线/转向/静止三种运动。
- 优先使用已有真实录制；没有足够素材时，仿真只用于管线冒烟，并明确标注“非真实 IMU 证据”。
- 生成 `observations.jsonl`、`imu.jsonl`、可选 `pose.jsonl`、`eval-gt.json`（只给评测）。
- 实现并测试 `MotionEvidence`、VLM proposal、记忆写入三个 schema。
- 写一个 GT 泄漏扫描：运行时输入出现 `gt_`、`ground_truth`、`navmesh` 等字段即失败。

通过标准：

- schema 往返测试通过；
- 所有时间单调、帧引用存在；
- 不调用 VLM、不写长期库也能完成 fixture 校验；
- 明确记录素材来源、hash、坐标系和 IMU 单位。

### P1：RGB-only 闭环（先证明记忆链路）

工作：

- 用现有 `SpatialTopologyService` / SQLite 接入 observation；
- 文本查询地点，返回历史观测与代表图；
- 进程重启后能加载同一地点图；
- 暂不注入运动证据，作为对照基线。

通过标准：

- 20 条观测可顺序入库；
- 同一地点重访能关联；
- 查询能返回原始证据而不是模型摘要；
- 重启后地点、访问、边不丢；
- 失败/乱序/重复输入有明确错误，不静默修复。

### P2：惯性证据层（先不要求 VLM 使用）

工作：

- 适配 `dead-reckoning` 输出为 `MotionEvidence`；
- 可选接入 OpenVINS 导出的 pose/covariance，标为 `vio`；
- 保存原始 IMU 引用、校准窗口、bias、质量、断档；
- 实现时间对齐和单位检查；
- 在回放中把运动证据挂到对应观测窗口。

通过标准：

- 直线、90° 转向、静止三类 fixture 的方向/量级合理；
- 所有证据有 `source`、时间、坐标系、quality；
- 无协方差时明确 `null`，不出现 NaN/Infinity；
- 时间戳、相机帧和 IMU 窗口可追溯；
- 仍不把 GT 当运行时输入。

### P3：VLM 读取运动证据并写入记忆

工作：

- 在 prompt 中加入紧凑运动证据、地点候选、历史 anchor 和“允许拒答”规则；
- 实现严格 JSON 解析、一次协议修复、写入门禁；
- VLM 输出地点同一性、关系、记忆提议；程序决定是否提交；
- 记录每次 VLM 输入、原始输出、token、延迟和门禁结果。

通过标准（10 个预注册回放场景）：

- 10/10 输出通过 schema 或明确失败，不出现静默解析；
- 每个地点决定引用至少一个观测证据；声称使用运动时必须引用 motion ID；
- 0 次绕过门禁的数据库写入；
- 缺失运动、协方差不可用、图像冲突三类场景能 `uncertain`/`abstain`；
- 相同输入重跑不产生不可解释的地点爆炸。

### P4：重访、重定位与纠错

工作：

- 候选检索：视觉候选 + 地点先验 + 运动一致性；
- VLM 核验候选，输出 accept/reject/uncertain；
- 接受时更新 visit/edge；拒绝时保留候选和理由；不确定时进入待定；
- 实现 merge/split/undo 的可逆路径；
- 测试外观变化、遮挡、相似地点、错误闭环。

通过标准（预注册 10 次重访）：

- 至少 8/10 给出正确的接受/拒绝/待定，不以“全部接受”刷高；
- 有正面冲突证据时不发生错误合并；
- 每次 merge/split 都可 undo，原始观测仍可查；
- 进程重启后能恢复上次地点和待定假设；
- 失败案例保留图像、运动证据、VLM 原文和门禁原因。

### P5：语义目标导航闭环

工作：

- 文本目标 → 地点候选 → VLM 选择目标/意图；
- 只在已观察到的 `transitions` 上规划拓扑路径，不凭空造可导航边；
- 输出到仿真 waypoint 执行器；第一版不做实机；
- 记录路径、执行结果、失败点和记忆变化；
- 跨 3 个会话验证长期记忆可用。

通过标准：

- 5 条简单路线完成 5/5（仿真冒烟）；
- 3 条需要重访的路线至少 2/3，失败必须保留；
- 导航途中不读 GT 坐标；执行器只接收允许的位姿/waypoint；
- 结束后长期记忆仍可通过文本查询复现路径和地点；
- 不以导航成功反推记忆一定正确，分别报告地点错误和导航错误。

### P6：可选的科研增量（不属于本次项目验收）

只有 P0–P5 稳定后才考虑：

- 学习式运动 tokenizer；
- 协方差感知的跨时间注意力；
- VLM 主导的记忆写入策略；
- 与 CROSS / Navigator / NavHarness 的系统对照。

这些需要另立实验协议，不能混入本次闭环验收，也不能因为“没找到”就宣称首次。

## 8. 测试矩阵

| 场景 | 输入 | 期望 |
|---|---|---|
| 直线前进 | 2 m 近似直线，IMU 连续 | 位移方向正确；quality 有来源；不产生新地点 |
| 原地 90° 转向 | 无平移，yaw 变化 | 不把转向误判为位移；新视角可触发新观测但不必新地点 |
| 静止 | 只有噪声 | `stationary=true`；不因漂移创建地点 |
| 同一地点重访 | 不同时间、不同视角 | 关联到旧地点；保留旧代表图 |
| 新地点 | 新布局/边界 | 创建新地点；不错误并入旧地点 |
| 相似但不同地点 | 外观相似、结构不同 | `uncertain` 或拒绝；不能只靠相似度合并 |
| 外观变化 | 光照/遮挡/家具变化 | 允许 VLM 基于结构接受；保留旧观测 |
| 遮挡/断帧 | 关键帧缺失 | 不推断未看见的空间；不更新边 |
| IMU 断档 | 时间跳跃 | 拒绝/降级该运动证据；不静默插值 |
| 协方差缺失 | 只有 pose 或低质量 IMU | `covariance=null`；VLM 不得声称精确不确定性 |
| 冲突观测 | 新证据与旧地点不相容 | 进入 hypothesis/revision；不覆盖旧地点 |
| 重启恢复 | 进程结束再启动 | 地点、访问、边、待定假设可恢复 |
| GT 泄漏 | 运行时 payload 带 GT 字段 | 直接失败并停止该阶段 |

## 9. 指标与证据

### 9.1 工程指标（主）

- schema 合法率；
- 门禁拦截率、绕过写入次数（必须为 0）；
- 时间/坐标/协方差错误数；
- 重启恢复成功率；
- 每个决定的证据引用完整率；
- VLM 调用数、token、延迟、失败与重试；
- 原始观测保留率、revision 可 undo 率。

### 9.2 记忆指标

- 地点关联 precision/recall；
- 错误合并、错误拆分、重复地点；
- 待定假设的解决率与解决延迟；
- 重访后正确恢复率；
- 历史证据召回率、错误肯定、拒答；
- 路径/边证据是否来自真实连续观测。

### 9.3 定位与导航指标

- 候选召回率（VLM 前）；
- 重定位接受 precision；
- 运动一致性门禁的误拒/误收；
- 仿真任务成功率、路径长度、失败类型；
- 长期会话后的地点恢复率。

### 9.4 记录格式

每次运行写入：

```text
run/spatial-loop/<run-id>/
  manifest.json          # commit、配置、模型 ID、预算、输入 hash
  observations.jsonl
  imu.jsonl
  motion-evidence.jsonl
  vlm-inputs/
  vlm-outputs/
  gate-decisions.jsonl
  memory-before.sqlite
  memory-after.sqlite
  revisions.jsonl
  metrics.json
  failures.jsonl
```

GT 单独放 `eval/`，不进入运行时目录；评分程序只读运行产物与 GT 的副本。

## 10. 失败与停止规则

出现以下情况，停止该阶段，不以“调一下试试”继续出正式结果：

- 运行时发现 GT 位姿、GT 地点、navmesh 或参考答案泄漏；
- 时间戳/外参/坐标 frame 未确认，仍要写全局地点；
- 协方差不可用却输出数值 sigma 或精确概率；
- VLM 输出无法通过 schema，且一次修复仍失败；
- 门禁拒绝后仍发生数据库写入；
- 候选歧义却直接合并地点；
- 冲突证据被删除或覆盖；
- API 预算/额度/网络失败导致批量运行不完整；
- 导航执行失败但记忆被反向改写以“自洽”。

失败必须保留：输入、原始输出、门禁原因、数据库 before/after、复现命令。失败样本不能从分母删除。

## 11. 代码落点与实施顺序

不重写现有主链路；新增一个受控闭环层，复用已有服务。

建议新增：

```text
src/spatial-loop/
  contracts.ts          # Observation / MotionEvidence / VlmProposal / GateDecision
  motion-evidence.ts    # dead-reckoning / VIO 适配、时间与单位校验
  evidence-builder.ts   # 短期上下文 + 候选 + 运动摘要
  vlm-proposer.ts       # Qwen 调用、严格 JSON、一次协议修复
  write-gate.ts         # ID 白名单、因果、坐标、协方差、冲突
  memory-commit.ts      # SQLite 事务、假设、revision
  relocalize.ts         # 候选检索 + VLM 核验 + 接受/拒绝
  navigate.ts           # 目标地点 → 拓扑路径 → 仿真 waypoint
  loop.ts               # 端到端编排与预算
  *.test.ts
```

需要小改的现有文件：

- `src/agent/spatial-sqlite-store.ts`：schema 1→2 迁移、motion/hypothesis/relocalization 表；
- `src/agent/spatial-working-context.ts`：增加运动证据与未决提议的容量上限；
- `src/agent/spatial-topology-vlm.ts`：抽出可复用的 Qwen 调用/审计，不复制业务判断；
- `src/agent/agent.ts`：只在受控闭环入口注入运动摘要，不改变现有生活助手默认行为；
- `src/dead-reckoning.ts`：补协方差/质量输出时保持旧字段兼容。

实施顺序：

1. P0 契约与 fixture；
2. P1 RGB-only 闭环；
3. P2 运动证据层；
4. P3 VLM 提议与门禁；
5. P4 重定位与纠错；
6. P5 仿真导航；
7. P6 只作为后续研究，不进入本次验收。

## 12. 完成定义（Definition of Done）

全部满足才算闭环完成：

- [ ] 同一 fixture 可以重复回放，输入和代码版本可追溯。
- [ ] 原始 IMU 生成 `MotionEvidence`，来源、时间、坐标系、质量明确；无协方差时不伪造。
- [ ] VLM 收到运动证据并在输出中引用；没有引用就不能声称使用了惯性。
- [ ] 短期记忆有界，长期记忆跨进程重启保留。
- [ ] 地点创建、关联、更新、合并、拆分、纠错都有证据和 revision。
- [ ] 重访能接受、拒绝或待定；错误合并不因相似度发生。
- [ ] 语义目标可在仿真中走到目标地点；路径只使用已观察的边。
- [ ] 运行时零 GT 泄漏；评分与运行分离。
- [ ] 每个失败都有原始输入、模型输出、门禁原因和重跑命令。
- [ ] 报告分别列出“工程通过项”和“未通过/未验证项”，不把 smoke test 写成科学结论。

## 13. 下一步只做五件事

1. 选定并冻结一个回放 fixture（3 个地点、一次重访、三种运动）。
2. 写 `contracts.ts` 和 schema 测试，不调用模型。
3. 把 `dead-reckoning` 和可选 OpenVINS 输出接成 `MotionEvidence`，先只入库、不推理。
4. 给 SQLite 加 v2 迁移和 `motion_evidence` / `place_hypotheses` 测试。
5. 做一个无 VLM 的回放 harness，验证“观测→证据→记忆→重启恢复”。

完成这五步后再决定是否进入 P3 的付费模型调用。当前不启动训练、不替换定位算法、不上实机、不按测试结果调阈值。
