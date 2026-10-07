# V2：持久 Place Memory（设计 + 实施计划）

依据 `迭代建议.md`，并把现有三 agent 架构升级为**持久的地点记忆**，而不是重写。核心只有三件事：**把 Scene 从“会话内识别结果”升级成持久 Place Node；增加 Visit；增加 Scene-to-Scene Transition Graph。** 不做精确 3D/位移。

## 1. 数据模型（`src/agent/place-memory.ts`）

```ts
interface PlaceNode {
  id: string;                 // scene-1 ...
  label: string;              // "Kitchen"（VLM 给的，可后改）
  summary: string;
  objects: string[];
  representativeFrames: string[];   // 代表帧路径
  visits: Visit[];
  neighbors: { sceneId: string; count: number }[];
  createdAt: number;
  lastVisitedAt: number;
  confidence: number;
  provisional: boolean;       // 尚未确认的地点身份
}

interface Visit {
  id: string;
  sceneId: string | null;             // 已确认时
  sceneCandidates?: { sceneId: string; score: number }[];  // provisional 时
  startMs: number; endMs: number | null;
  entryFrame: string; exitFrame: string | null;
  representativeFrames: string[];
  rawArchivePointer: string | null;   // 原始帧范围/目录
  changes: { atMs: number; what: string; via: string }[];
  previousSceneId: string | null;     // 进入前的场景
  nextSceneId: string | null;
}

interface Transition {
  id: string;
  fromScene: string; toScene: string;
  count: number;
  /** 通常路径：多次经过后归纳出的常见走法（定性，自然语言），写在边上。 */
  path: string;
  /** 观察到的若干版本及其出现次数，用于归纳与修正。 */
  pathVariants: { path: string; count: number }[];
  durationMs: number | null;
  evidence: string[];       // 进入/退出帧
  confidence: number;
}
```

**边的语义（用户要求）**：不需要 3D，只要知道**两个场景之间的通常路径**，写在边上。做法：

- 每次识别到 `A → B` 转换，把**转换期间的运动模式**（定性，自然语言，如"先左转约90°，再前进约4步，再右转"）作为一次 path variant 记到 `A—B` 边上；
- 多次经过后，边上的 `path` = **出现最多的那个 variant**（并保留 variants 计数），`count++`、更新 duration；
- 路径是**定性/拓扑**的，不含坐标；后续可用它回答"从卧室怎么去厨房"、也可以反过来收紧候选（先匹配邻居）。

持久化到 `run/experiments/<session>/place-memory.json`（或按 session 的 store），支持 `mergeScene(a,b)` / `splitScene(a)` / `rebindVisit(visitId, oldScene, newScene)`。

## 1.5 运动信息边界（模拟器与真机一致）

- 三个 agent 都**只接收定性运动模式**（`none` / `perfect` / `noisy`），**不接收坐标、速度、净位移**。
- 模拟器的精确位姿**只用于评测与路线生成**，绝不进 agent 输入。
- **不合成 IMU 数据流**：端上 VIO 的失败模式用 `noisy`（丢段、把转向读成横移、角度缩放）近似。采集与派生见 `sim/README.md`。

## 2. SceneAgent：Place Recognition（升级，不扩职责）

只回答“当前是不是以前来过的地方”，输出 `scene_id + confidence + candidates + evidence`，不给坐标。

匹配流程（**cheap CV 找候选 → VLM 只做验证**）：

```
current frames
  → 候选集 = neighbors(previousScene) ∪ 最近访问的若干 scene
  → cheap CV（现有 image memory：SIFT + RANSAC 内点；后续可换 embedding）打分
  → top-k（k≈3）
  → VLM 验证：“当前画面与候选 X 是否同一地点？”
  → existing scene / new scene
  → 若 top-1 与 top-2 接近 → provisional（不硬绑定）
```

- 图邻居优先，历史越多也不线性变慢；邻居都不像时再全局搜索。
- 每次进入创建/延续一个 **Visit**；离开（识别到新场景）时结束该 Visit 并写 Transition。
- **允许修正**：provisional visit 后续用新证据或图上下文 resolve；支持 merge/rebind。

## 3. SceneChangeAgent：只在身份已知后运行

数据流：`current → SceneAgent → scene_id → 载入该 scene 历史 → ChangeAgent`。

- 只比较 `Current(scene_X)` vs `Historical(scene_X)`（该地点的代表帧/上次 Visit），不跟整个世界比。
- 保留现有“配准 + 残差 + 边缘抑制 + 显著块”作为触发/提示；判不准时交给 VLM。
- 变化写回该 Visit 的 `changes[]` 与该 PlaceNode 的 `current_state`。

## 4. RequestAgent：沿 Place Memory 检索

- 保留工具式检索（agent 自决），但把 `search_scene_memory` 扩展为：
  - `recent_visits()`、`scene_history(scene_or_label)`、`neighbors(scene_id)`；
  - 以后再加 `recover(visit_id | time_range)`（从 `rawArchivePointer` 恢复代表帧之外的原始帧）。
- 例如“我刚才去过哪些地方？” → `recent_visits`；“之前在厨房看到过什么？” → `scene_history(Kitchen)`。

## 5. 自动评测 harness（`sim/replay-eval`）

读 `run/sim/<episode>/`，把帧按 agent 触发节奏喂给被测 SceneAgent（真实或桩），用 `observations.jsonl` 的 **GT 房间**打分：

| 指标 | 含义 |
|---|---|
| place accuracy / purity | 每个预测 scene 映射到 GT 房间后的准确率（Hungarian/多数投票） |
| revisit consistency | 同一房间的两次访问是否落到同一预测 scene |
| transition graph F1 | 预测相邻关系 vs GT 房间邻接 |
| visits per place | 每个地点的访问次数是否合理 |

先跑**cheap CV 部分**（不花 VLM）快速迭代匹配/候选策略，再接真实 VLM 跑验证。

### 5.1 首轮评测发现（val-5）

| 模式 | places | accuracy | purity | revisit | transition F1 |
|---|---|---|---|---|---|
| cheap CV（SIFT） | 11–29 | 0.91–0.94 | 0.91–0.94 | 0.26–0.50 | 0.83–0.86 |
| VLM（真实 Qwen） | **2** | **0.44** | 0.44 | 0.81 | **0.00** |

- **cheap CV 严重过分割**：SIFT+RANSAC 是"同一块表面"匹配器，不是"同一地点"识别器；换视角/重叠少就判不匹配 → 同一房间被切成很多 place。加全局候选回退也救不了（不是候选覆盖问题）。
- **VLM 单独严重过合并**：把 4 个房间并成 2 个 place，accuracy 与 transition 直接崩。原因：提示偏向复用、候选中只有"已知地点"、缺少运动与图上下文。
- **结论**：两者单独都不够。下一步把 `matchScore`（SIFT 重叠）与 `motionHint`（平移/转向）作为两个**特征**，引入 `PlaceGraphMemory`（1-hop → 2-hop → global）参与候选与判断，并让 VLM 把"**新地点**"当作一等选项、只在真正歧义时做验证。这正是 `建议2.md` 的方向。

### 5.2 图结构（已实现）

- `motion-hint.ts`：把自然语言运动解析成结构化 `MotionHint`（moving / duration / distance / turn / turnAmount / level，允许 unknown），并支持聚合与相似度；
- `place-memory.ts`：边累积多次 transition 的**直方图 + 通常路径**（vocabulary vote），提供 `expectedNext(from, hint)` —— "从这里、以这种运动出发，通常到哪"；
- `SceneAgent`：候选优先取 `expectedNext`（图记忆）→ 邻居 → 最近 → 全局；转换时把聚合后的运动写回边；
- 评测新增 **same-path recall**：用已建图做 `expectedNext` 预测下一地点的命中率（val-5 首测 0.5，3/6），并导出学习到的边（含通常路径）。

## 6. 实施顺序

1. **P0 模拟器**（已完成）：`sim/record_episode.py` 产出带 GT 的往返 episode。
2. **P1 Scene Recognition**：Place Memory 数据模型 + 候选收窄 + VLM 验证 + 评测 harness（先 cheap CV 打分）。
3. **P2 Place Graph**：transition 边 + `neighbors` 候选。
4. **P3 Visit Memory**：Visit 生命周期、代表帧、raw archive 指针。
5. **P4 Scene Correction**：provisional / merge / split / rebind。

## 7. 暂不做

精确 3D 重建、全局 XYZ、IMU 双积分轨迹、SLAM、物体级坐标、复杂 memory 层级/折叠策略/多 agent 记忆管理。
