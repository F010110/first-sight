对，而且我会把方向再收紧一点：

> **你现在最应该“照抄”的不是某个 SpatialVLM，而是一个已经被机器人领域验证过的“空间感知模块架构”。**

因为你真正缺的不是一句更聪明的视觉回答，而是一个持续维护的 **world state**：我现在朝哪、周围有哪些对象、对象在哪里、刚才看到的对象现在相对我在哪里。

在我查到的现成方案里，**最适合你作为第一版蓝本的是 ConceptGraphs；如果以后要追求真正实时，再往 Hydra + Clio 靠。**

### 四个候选架构怎么选

| 架构 | 输入 | 输出 | 是否需要自己训练 | 实时性 | 和你的匹配度 |
|---|---|---|---|---|---|
| **ConceptGraphs** | posed RGB-D | object-level 3D scene graph | 基本不需要，依赖预训练模型 | 中等/偏慢 | **最高，建议先抄** |
| **Hydra** | RGB-D/VIO + semantics | 实时 hierarchical 3D scene graph | 不需要重新训练核心图结构 | **实时** | 很高，但工程重 |
| **Clio** | Hydra式空间前端 + task text | task-driven compact scene graph | 不需要为每个任务训练 | **实时设计** | **非常符合你“只关心用户当前任务”** |
| **VLMaps** | RGB-D + pose | language-feature top-down map | 不需要 | 中等 | 简单，但更像导航地图，不够 object-centric |
| **HOV-SG** | RGB-D + pose | building/room/object 层级图 | 主要使用预训练模型 | 偏重 | 适合大空间，第一版太复杂 |
| **Mono-Hydra** | RGB + IMU | metric-semantic scene graph | 作者提供完整研究系统 | 报告约 15 FPS | 没深度硬件时非常值得看 |

如果你让我只选一个：

> **先照 ConceptGraphs 的 pipeline 做一个 ConceptGraphs-Lite。**

不是因为它最先进，而是因为它最接近你现在的能力和产品需求。

---

## ConceptGraphs 到底做了什么？

它的输入不是：

> 一张图片 → 一段文字。

而是：

```text
连续 RGB 图像
    +
Depth
    +
拍每张图时的 Camera Pose
        │
        ▼
2D Object / Region Segmentation
        │
        ▼
视觉语义特征
        │
        ▼
根据 Depth 投影到 3D
        │
        ▼
跨帧关联
“这一帧的杯子和上一帧是同一个吗？”
        │
        ▼
Object-level 3D Map
        │
        ▼
Scene Graph
```

最后得到的东西类似：

```text
Room_1
│
├── Table_3
│      position = (2.1, 0.8, 3.2)
│      ├── Cup_17
│      └── Keys_22
│
├── Chair_5
│
└── Door_2
```

其中：

```text
Keys_22:
    semantic = "keys"
    position = (2.3, 0.9, 3.1)
    last_seen = 12:52:21
    confidence = 0.89
```

这就已经是你想要的“机器人视觉模块”了。

ConceptGraphs 的核心优势恰恰是：它使用已经训练好的 2D foundation models，把多视角 RGB-D 信息融合成开放词汇 3D scene graph，**不要求你为了自己的物体类别重新训练一个 3D 模型**。[Gu et al., 2024](https://ieeexplore.ieee.org/abstract/document/10610243/)；项目页：[concept-graphs.github.io](https://concept-graphs.github.io/)

---

# 然后，把机器人的最后一半全部砍掉

原始机器人：

```text
Spatial Perception
      ↓
World Model
      ↓
Planner
      ↓
Navigation / Manipulation
      ↓
Motor
```

你们：

```text
Spatial Perception
      ↓
World Model
      ↓
Speaking Policy
      ↓
Speech
```

也就是说，你只需要照抄：

> **Robot 的 perception + world model**

后面的 motion planning、path planning、VLA、motor control 全部不要。

这就是为什么我现在反而不建议你去找一个完整 VLA。

---

# 你们的第一版可以长这样

我会把它拆成两个完全不同速度的循环：

```text
           Camera + IMU
                │
       ┌────────┴────────┐
       │                 │
       ▼                 ▼
  FAST SPATIAL       SLOW SEMANTIC
     LOOP                LOOP

 pose / depth        object meaning
 tracking            OCR
 geometry            task relevance
     │                 │
     │                 │
     └────────┬────────┘
              ▼
       3D Scene Graph
              │
      ┌───────┴────────┐
      │                │
 current pose       user task
      │                │
      └───────┬────────┘
              ▼
       Speaking Policy
              │
         SPEAK / SILENCE
```

这和 Hydra 的思想尤其接近。

Hydra 论文自己就把系统描述成：

> **fast early/mid-level perception + slower high-level perception**

然后在线维护 3D dynamic scene graph。

这几乎就是你们现在遇到的：

> 快速摄像头 + 慢速语义模型

问题。[Hughes et al., 2022](https://arxiv.org/abs/2201.13360)

---

## 为什么我特别建议你研究 Hydra

因为 Hydra 已经替你解决了一个架构问题：

> **是不是所有视觉计算都必须同频？**

答案是不需要。

Hydra 把：

- 低层几何；
- 局部空间；
- places；
- rooms；
- objects；

放在不同层次里增量维护。

因此整个 world state 类似：

```text
Building
   ↓
Room
   ↓
Place
   ↓
Object
   ↓
Geometry
```

而不是：

> 每隔 15 秒重新问模型“你现在看到什么”。

这两种系统哲学差别非常大。

---

# Clio 甚至比 Hydra 更像你们

Clio 是我觉得你后面非常值得“抄思想”的一个架构。

它问的问题是：

> 世界里东西太多了，机器人到底应该记什么？

它的答案：

> **由当前 task 决定。**

例如机器人任务：

> 找咖啡机。

那就没必要把墙上所有插座、装饰品、书、杯子都以同样粒度放进 scene graph。

Clio 使用自然语言任务来决定地图保留什么、以多细的粒度保存，并在线构造 task-driven 3D scene graph。[Maggio et al., 2024](https://arxiv.org/abs/2404.13696)

这与你们完全对应。

用户说：

> “帮我找钥匙。”

那么你们的 spatial world 不需要此刻理解：

```text
窗帘是什么颜色
墙上是什么画
电脑型号是什么
```

它需要特别提高：

```text
key
table
desk
bag
drawer
可能作为定位参照的物体
```

所以你的 Agent task：

```text
current_task = FIND(keys)
```

应该直接影响视觉模块。

这就是非常标准的 embodied perception 思路。

---

# 如果你只有摄像头 + IMU，也已经有人做了

这点也很重要。

标准 ConceptGraphs / Hydra 往往比较喜欢 RGB-D。

但智能眼镜不一定有深度传感器。

**Mono-Hydra** 就是在解决这个问题：

```text
monocular RGB
+
IMU
↓
estimated depth
+
semantics
+
VIO
↓
3D scene graph
```

作者公开了代码：

[github.com/UAV-Centre-ITC/Mono_Hydra](https://github.com/UAV-Centre-ITC/Mono_Hydra)

论文报告其早期版本在笔记本 RTX 3080 上可以约 15 FPS 地构建 scene graph，并报告了实时 monocular RGB + IMU 空间感知结果。[Udugama et al., 2023](https://arxiv.org/abs/2308.05515)

2026 年他们又出了 Mono-Hydra++，进一步将几何 foundation model、VIO、depth 和 scene graph 整合到 RGB + IMU pipeline。

所以甚至：

> “智能眼镜只有 RGB + IMU，能不能走机器人 3D scene graph 路线？”

答案也是：

> **可以，而且已经有人做了基本相同的机器人视觉问题。**

---

# 但你现在不要真的把整套 Hydra 搬进手机

这是关键。

你说你主要会调 API。

Hydra 是机器人研究系统，C++、ROS、VIO、mesh、ESDF、图优化……如果你直接 fork，项目可能马上从：

> 做视障产品

变成：

> 花三个月编译机器人代码。

不划算。

所以我建议你：

> **照抄它的 architecture，不一定直接照抄 implementation。**

---

# 你现在真正可以做一个“Embodied Vision Service”

也就是把整个机器人视觉模块独立成一个服务。

手机端永远只干：

```text
RGB frame
Depth（如果有）
Pose
Timestamp
IMU 可选
```

发给：

```text
POST /observe
```

空间服务返回：

```json
{
  "camera_pose": "...",
  "objects": [
    {
      "id": "obj_17",
      "concept": "cup",
      "position_world": [1.2, 0.8, 2.4],
      "confidence": 0.91,
      "last_seen": 1758950240
    },
    {
      "id": "obj_31",
      "concept": "table",
      "position_world": [1.4, 0.4, 2.6],
      "confidence": 0.96
    }
  ],
  "relations": [
    ["obj_17", "on", "obj_31"]
  ]
}
```

你的 App 根本不用知道里面是：

> ConceptGraphs  
> Hydra  
> Mono-Hydra  
> 以后某个 Spatial Foundation Model

还是别的。

App 只认识：

> **Spatial API。**

这个抽象会特别有价值。

---

# VLM 在这个架构里的位置也会变得合理

例如系统当前发现一个 region：

```text
object_52
3D position 已经知道
```

但不知道它是什么。

这时候：

```text
crop(object_52)
↓
Qwen
↓
“这是一个白色马克杯”
```

然后：

```text
object_52.semantic = mug
```

所以：

> **geometry first，semantics attach later。**

而不是现在：

> VLM一句话同时负责是什么、在哪里、要不要说。

---

# VLM 13 秒慢，也突然没那么严重了

举个例子。

用户现在看到一把椅子：

```text
t = 0 s
```

快速空间模块立刻建立：

```text
obj_31
position = world(2.3, 0.0, 4.1)
```

语义还不知道是什么。

图像 crop 发给 Qwen。

用户继续转头。

13 秒以后：

```text
Qwen → “chair”
```

于是只是：

```text
obj_31.label = chair
```

这时候系统根据**当前**用户 pose 重新计算：

```text
chair relative to user NOW
```

可能得到：

> “椅子现在在你左后方。”

这就不是用 13 秒以前的画面方向指导用户了。

这正是机器人 spatial world model 带来的价值。

---

# 第一版其实连“完整 Scene Graph”都不用做

你完全可以从：

> **Object Map**

开始。

只需要：

```text
object_id
semantic
3D_position
last_seen
confidence
mobility
```

不要：

```text
room
place
building
topology
mesh
complex graph relation
```

用户找东西时已经够用了。

例如：

```text
obj_1 = keys
obj_2 = cup
obj_3 = chair
obj_4 = door
```

然后维护空间位置。

这相当于：

> **ConceptGraphs 去掉 70% 功能。**

我觉得这是非常合理的 MVP。

---

# 我的实际选择会是

**第一代：ConceptGraphs-Lite。**

架构照搬：

```text
posed RGB-D
→ segmentation
→ semantic embedding
→ project to 3D
→ multi-view association
→ object map
```

但是只保存当前任务相关 object。

等你确认这个产品体验成立以后：

**第二代：往 Clio 靠。**

变成：

```text
task-driven object granularity
+
incremental online mapping
```

然后如果真的需要：

> 更快、长期空间记忆、大范围室内空间

再往：

**Hydra / Mono-Hydra / HOV-SG**

靠。

---

## 哪个不要先抄？

反而是 **SpatialVLM / SpatialBot / RoboSpatial**。

这些很值得以后把某个感知 component 换掉，但它们主要解决：

> 模型能不能理解空间？

它们并没有天然替你解决：

> 跨 30 秒持续维护一个稳定、可查询的世界。

而你们产品最关键的恰恰是后者。

所以第一优先级应该是：

> **mapping architecture**

而不是：

> **换一个更会回答空间问题的大模型。**

这也是我目前对你们架构判断最大的改变。

你真正需要复制的“机器人视觉模块”不是一个神经网络，而是：

> **Perception → Mapping → Persistent World State**

这一整个模块。

### 最值得直接照着看的现有工作

1. *Gu, Q., Kuwajerwala, A., Morin, S., et al. (2024). ConceptGraphs: Open-Vocabulary 3D Scene Graphs for Perception and Planning. ICRA. [IEEE](https://ieeexplore.ieee.org/abstract/document/10610243/) · [Project](https://concept-graphs.github.io/)*
2. *Hughes, N., Chang, Y., & Carlone, L. (2022). Hydra: A Real-time Spatial Perception System for 3D Scene Graph Construction and Optimization. [arXiv](https://arxiv.org/abs/2201.13360)*
3. *Maggio, D., Chang, Y., Hughes, N., et al. (2024). Clio: Real-time Task-Driven Open-Set 3D Scene Graphs. IEEE Robotics and Automation Letters. [arXiv](https://arxiv.org/abs/2404.13696)*
4. *Udugama, U. V. B. L., Vosselman, G., & Nex, F. (2023). Mono-Hydra: Real-Time 3D Scene Graph Construction from Monocular Camera Input with IMU. [arXiv](https://arxiv.org/abs/2308.05515) · [Code](https://github.com/UAV-Centre-ITC/Mono_Hydra)*
5. *Huang, C., Mees, O., Zeng, A., & Burgard, W. (2023). Visual Language Maps for Robot Navigation. ICRA. [IEEE](https://ieeexplore.ieee.org/abstract/document/10160969/) · [Project](https://vlmaps.github.io/)*
6. *Jatavallabhula, K. M., Kuwajerwala, A., Gu, Q., et al. (2023). ConceptFusion: Open-set Multimodal 3D Mapping. [arXiv](https://arxiv.org/abs/2302.07241)*
7. *Werby, A., Huang, C., Büchner, M., & Valada, A. (2024). Hierarchical Open-Vocabulary 3D Scene Graphs for Language-Grounded Robot Navigation. [OpenReview](https://openreview.net/forum?id=TL0Hb9OwfR)*
8. *Chen, B., Xia, F., Ichter, B., et al. (2023). Open-Vocabulary Queryable Scene Representations for Real World Planning. ICRA. [IEEE](https://ieeexplore.ieee.org/abstract/document/10161534/)*

如果现在就定技术路线，我会定成：

> **先复刻 ConceptGraphs 的“posed RGB-D → object-level 3D map”主干，只做 3–5 米局部空间和当前任务相关对象；语言输出继续用你现有的 Qwen。**

这样你是在**照抄一个真正的 embodied perception architecture**，同时又没有把项目拖进训练模型和完整机器人系统里。