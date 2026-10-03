对。你现在的 Router 最大的问题是：**把“视觉变化”直接当成“重新理解世界的理由”**。32×24 灰度差异很适合做便宜的运动/重复检测，但不适合直接控制 Agent。

我建议把 Router 改成一个 **Evidence Router（视觉证据路由器）**。它不判断语义，只做三件事：

> **这张图能不能用？它有没有提供新的视觉证据？现在值不值得花一次 VLM 调用？**

你现有架构里已经正确地把抓拍、模型调用、状态更新和用户输出分开了，这个基础可以保留。:chatgpt-content-reference{index="0"}

## Router V2

我会改成这条链：

```text
Camera
   ↓
Frame Buffer
   ↓
① Quality Gate
   │  清晰吗？曝光正常吗？
   │
   ↓
② Motion Episode
   │  用户正在转动？
   │  刚刚停止？
   │
   ↓
③ Visual Novelty
   │  和最近有效视觉状态相比，
   │  这张图真的提供新视角吗？
   │
   ↓
④ Representative Frame Manager
   │  相似的一组图片只留最好的一张
   │
   ↓
⑤ Trigger Arbiter
   │
   ├── IGNORE
   ├── STORE_ONLY
   ├── QUERY_CURRENT
   ├── QUERY_PREVIOUS+CURRENT
   └── WAIT_FOR_CONFIRMATION
             ↓
            VLM
             ↓
        Semantic Scene State
```

关键变化是：**`0.04`、`0.10`、`8 秒`不再直接决定“调用/不调用 VLM”。**

它们只能成为几个低级信号。

---

# 1. `0.04` 应该变成“运动状态”，而不是硬门

现在：

> 相邻差异 > 0.04 → 不稳定 → 什么都不做。

我会变成：

```text
STABLE
   ↓
MOVING
   ↓
SETTLING
   ↓
STABLE
```

并用 hysteresis，避免临界值抖动：

```text
difference > 0.06
→ MOVING

difference < 0.03 连续两帧
→ STABLE
```

用户转头的时候：

```text
MOVING
```

Router 不调用 VLM，但持续缓存。

一旦：

```text
MOVING → STABLE
```

立即从最近几张中挑**最清晰的一张**。

因此“转头结束”本身成为一个非常自然的 keyframe 时刻。

这和机器人视觉里的 keyframe/event-triggered perception 很类似：不是逐帧计算，而是在新的、有价值的视觉状态出现时更新。[Gallego et al., 2020](https://ieeexplore.ieee.org/abstract/document/9138762/)

---

# 2. `0.10` 不应该再叫“场景变化阈值”

它最多只能叫：

> **visual novelty**

因为这些情况都可能产生 >0.10：

- 转了90°，但仍在同一个房间；
- 灯突然打开；
- 有人从镜头前走过；
- 曝光自动调整；
- 真正从走廊进入会议室。

Router 根本没能力区分。

所以它应该只产生：

```text
new_visual_evidence = true
```

而不是：

```text
scene_changed = true
```

真正的：

```text
scene_changed
```

只能由上面的 Scene Model/VLM 输出。

---

# 3. 加一个特别重要的 `Scene State`

你刚刚加入的这个变量，我会把它做成核心。

例如：

```json
{
  "scene_id": 17,
  "summary": "indoor office corridor",
  "representative_frame": "F318",
  "confidence": 0.94,
  "status": "stable",
  "confirmed_at": "..."
}
```

场景状态只有三种：

```text
STABLE
SUSPECTED_CHANGE
CONFIRMED_CHANGE
```

而不是简单：

```text
changed: true/false
```

### 例如用户转头

Router：

> 画面变化很大。

因此：

```text
visual_novelty = high
```

调用一次 VLM。

VLM：

> 还是办公室，只是看向另一个方向。

结果：

```text
scene.status = STABLE
scene.changed = false
```

**不播报。**

---

### 用户走进会议室

Router：

> 稳定后出现非常新的视觉证据。

VLM：

> 场景从走廊变成会议室。

而且：

```text
confidence = .96
```

那么：

```text
CONFIRMED_CHANGE
```

这才成为播报候选。

---

### VLM不确定

例如：

```text
confidence = .62
```

不要播。

进入：

```text
SUSPECTED_CHANGE
```

然后 Router 等下一张**新的清晰帧**。

不是立即再发同一张图。

第二张确认：

```text
SUSPECTED_CHANGE
   ↓
CONFIRMED_CHANGE
```

才允许上层 Attention Policy考虑播报。

这非常适合你说的：

> **只有明显、确定的场景变化才可能触发。**

---

# 4. 相似图片不要“跳过”，而应该形成一个 Visual Cluster

你现在：

> 差异 ≤ 0.012 → cache hit → 跳过。

方向是对的，但还可以再抽象一下。

例如最近：

```text
F101  模糊
F102  一般
F103  很清晰
F104  很清晰
F105  曝光差
```

五张其实是同一个视觉状态。

建立：

```text
Visual Cluster 28
```

只保存：

```text
representative = F103
```

于是：

```text
Cluster 28
 ├ F101
 ├ F102
 ├ F103 ← BEST
 ├ F104
 └ F105
```

送 VLM 永远只送：

> F103。

这比单纯“第一张命中 cache 后跳过”更好，因为**后来可能出现更清晰的同场景图片**。

---

# 5. “相似”也不能只靠32×24灰度

32×24特别适合：

> 检测快速运动。

但不太适合：

> 判断是不是同一种视觉内容。

例如：

```text
一张桌面，没有钥匙
一张桌面，多了一把很小的钥匙
```

灰度差可能只有：

> 0.005

但对找钥匙任务来说是巨大的变化。

所以我会保留两套 novelty：

```text
motion_difference
    ↓
32×24 grayscale
非常便宜

visual_similarity
    ↓
perceptual hash / tiny image embedding
稍微贵一点，但仍在本地
```

于是：

```text
motion_difference
```

负责：

> 手机是不是在动？

```text
visual_similarity
```

负责：

> 这是不是本质上同一个视角？

以后如果真的需要更强，可以把第二层换成 MobileCLIP 一类小视觉 encoder；Router接口不需要改变。

---

# 6. 8 秒 cooldown 应该取消“绝对含义”

这个参数对具体控制最危险。

例如找钥匙：

```text
0s
向右扫
→ VLM调用

3s
用户转到新方向并停住
→ 一张非常好的新照片出现
```

如果还处于：

```text
8 秒 cooldown
```

你会错过最有价值的图。

所以应该变成：

> **Same-evidence cooldown**

而不是：

> Global cooldown。

也就是说：

```text
如果仍然是同一个视觉 cluster
→ cooldown

如果出现明确新的代表帧
→ 可以立即调用
```

仍然保持：

```text
最多一个请求 in-flight
+
只保留 latest pending evidence
```

即可防止队列爆炸。

这与你现有“在途一个、合并自动请求”的设计非常兼容。:chatgpt-content-reference{index="1"}

---

# 7. Trigger Arbiter 不需要大量生活场景规则

它只需要看几个非常通用的信号：

```text
FrameQuality
VisualNovelty
SceneStatus
CurrentMode
CurrentTask
ModelUncertainty
LastQueryEvidence
```

然后做简单决策。

例如：

### Quiet

```text
scene stable
→ 不调用

high visual novelty
→ 允许检查一次 scene

scene suspected
→ 等下一张好图复核
```

---

### Task

```text
出现新的高质量视角
→ 立即允许分析

不需要等 scene change
```

因为：

> 找钥匙的时候，同一个房间就是要不断观察。

---

### Explore

```text
用户主动请求
→ 立即分析当前最佳帧
```

---

### Awareness

```text
scene suspected / significant new evidence
→ 检查

confirmed material scene change
→ 才进入播报判断
```

这里模式只是改变：

> **调用门槛**

而不是写几百条生活场景规则。

---

# 8. VLM 输入也应该由 Router 决定形态

不要永远发：

> 最近四张。

Router 可以输出不同 request type。

### 普通观察

```text
QUERY_CURRENT

→ 只发当前最佳照片
```

---

### 判断是不是新场景

```text
QUERY_SCENE_TRANSITION

previous_scene_summary
+
previous representative image（必要时）
+
current representative
```

最多两张。

---

### Task需要多视角

```text
QUERY_TASK

当前最近的 2–3 个
真正不同 viewpoint
```

不是最近三张。

---

### 疑似场景变化

```text
VERIFY

只发下一张新的高质量证据
+
已有 suspected state
```

这样数据量会明显下降。

---

# 实际生活中的效果会完全不同

### 情况 A：用户沿熟悉街道走

摄像头当然不停变化。

旧 Router：

```text
不断超过0.10
→ 不断触发
```

Router V2：

```text
移动
→ 等稳定
→ representative frame
→ 高 novelty
→ 偶尔让 VLM确认 scene

VLM：
仍是 pedestrian street
scene stable

→ 不播
```

而后续相似街景可以大量 cache。

---

### 情况 B：从街上走进便利店

```text
MOVING
↓
STABLE
↓
产生新的代表帧
↓
visual novelty 很高
↓
VLM
```

结果：

```text
previous:
outdoor street

current:
indoor convenience store

confidence .97
material_change true
```

：

```text
CONFIRMED_CHANGE
```

环境模式才可能：

> “进入了一家商店。”

---

### 情况 C：桌上找钥匙

这里 `scene` 可能十分钟都不变：

```text
office desk
```

但 Task：

```text
FIND(keys)
```

用户每次扫到新的稳定视角：

```text
new viewpoint
↓
选最清晰图片
↓
立刻分析
```

完全绕过 scene-change gate。

所以：

> **Scene 不再控制 Task perception。**

这点很重要。

---

### 情况 D：读药盒

用户把药盒举起来，开始摇晃。

```text
MOVING / blur
→ 不发
```

停稳：

```text
F1 blurry
F2 sharp
F3 almost identical
```

Visual Cluster：

```text
只留下 F2
```

发：

> 一张图。

这比现在“时间均匀抽四帧”会可靠很多。

---

# 所以我会把你现在几个阈值重新定位

| 当前变量 | Router V2 里的含义 |
|---|---|
| `0.04` | 运动检测信号，不是分析 gate |
| `0.10` | 粗视觉 novelty 信号，不是 scene-change |
| `0.012` | visual cluster 的一个输入，不再等同于最终 cache 判断 |
| 5 秒最小间隔 | 只对重复/低价值观察适用 |
| 8 秒 cooldown | 改成 same-evidence cooldown |
| “场景变化” | **只有 VLM Scene Model 可以确认** |

也就是说底层 Router 不需要变得“更聪明”。

反而应该变得：

> **职责更窄、更机械、更可靠。**

---

## 最后我会把它压缩成三个核心对象

### `FrameCandidate`

```text
image
quality
motion_state
visual_embedding/signature
timestamp
```

### `VisualState`

```text
cluster_id
representative_frame
novelty
last_queried
```

### `SemanticScene`

```text
scene_id
summary
confidence

status:
stable
suspected_change
confirmed_change

representative_frame
```

它们分别回答：

> **这张图好不好？**

> **这是不是新的视觉证据？**

> **世界的语义状态真的变了吗？**

不要让一个 `difference > 0.10` 同时回答三个问题。

---

我认为这会是当前 Router 最有价值的一次重构：

> **Camera Router 从“阈值触发器”变成“关键视觉证据管理器”；Scene/VLM 从“每次描述图片”变成“语义状态更新器”。**

而且它并不要求你现在训练任何东西。将来如果 proactive model 或经过微调的 scene-change model 变强，只需要替换最上面的 Semantic Scene 模块，Router 本身不必推倒重来。

### 相关研究方向

*Gallego, G., Delbrück, T., Orchard, G., et al. (2020). Event-Based Vision: A Survey. IEEE TPAMI. [IEEE](https://ieeexplore.ieee.org/abstract/document/9138762/)*

*Campos, C., Elvira, R., Rodríguez, J. J. G., Montiel, J. M. M., & Tardós, J. D. (2021). ORB-SLAM3. IEEE Transactions on Robotics. [IEEE](https://ieeexplore.ieee.org/abstract/document/9440682/)*

*Qin, T., Li, P., & Shen, S. (2018). VINS-Mono. IEEE Transactions on Robotics. [IEEE](https://ieeexplore.ieee.org/abstract/document/8421746/)*

*Li, M., Wang, Y.-X., & Ramanan, D. (2020). Towards Streaming Perception. ECCV. [Springer](https://link.springer.com/chapter/10.1007/978-3-030-58536-5_28)*

*Yates, R. D., Sun, Y., Brown, D. R., et al. (2021). Age of Information: An Introduction and Survey. IEEE JSAC. [IEEE](https://ieeexplore.ieee.org/abstract/document/9380899/)*

*Xu, Z., Lu, T., Zhao, Y., Wang, Y., et al. (2025). ActiveEye: Enabling Continuous and Responsive Video Understanding for Smart Eyewear Systems. IMWUT. [ACM](https://dl.acm.org/doi/abs/10.1145/3770641)*

*Xin, Y., Zuo, X., Lu, D., et al. (2023). SimpleMapping: Real-Time Visual-Inertial Dense Mapping with Deep Multi-View Stereo. ICRA. [IEEE](https://ieeexplore.ieee.org/abstract/document/10316359/)*

*Mustaniemi, J., Kannala, J., Särkkä, S., et al. (2018). Fast Motion Deblurring for Feature Detection and Matching Using Inertial Measurements. [IEEE](https://ieeexplore.ieee.org/abstract/document/8546041/)*