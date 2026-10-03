用户：我们先具体设计一个agent自动向用户播报的模式。

什么情况下agent应该自主向用户播报？什么时候保持沉默？

GPT：
可以，而且我觉得这应该成为整个产品最重要的一层：**不是“识别到了什么就播报什么”，而是“判断这个信息此刻是否值得打断用户”。**

从视障辅助和智能眼镜研究来看，一个共识越来越明显：持续描述容易造成认知负担，主动提示应该围绕任务相关性、时机、新颖性和用户当前负荷来控制。比如 AiGet 会在不合适的时机抑制通知；ProMemAssist 专门研究及时的 proactive assistance；针对视障实时多模态助手的研究也明确提出 “Less is More”——少而关键的信息通常比持续播报更好。[Cai et al., 2025](https://dl.acm.org/doi/abs/10.1145/3706598.3713953)；[Pu et al., 2025](https://dl.acm.org/doi/abs/10.1145/3746059.3747770)；[Zhao et al., 2025](https://arxiv.org/abs/2511.00945)

所以我会让系统**默认沉默**，只有候选信息通过一组门槛以后才播报。

## 我会先把主动播报分成 5 个等级

| 等级 | 什么时候主动说 | 例子 | 能不能打断当前语音 |
|---|---|---|---|
| **L0 紧急安全** | 即将影响用户安全，而且来自足够快速可靠的感知 | “停，前方有台阶。” | 可以 |
| **L1 当前任务关键进展** | 直接改变用户下一步行为 | “找到钥匙了，在画面右边。” | 一般可以 |
| **L2 状态变化** | 用户正在关注的东西发生重要变化 | “电梯门开了。”、“前面的人开始移动了。” | 通常可以等当前一句结束 |
| **L3 环境意识** | 新进入一个场景，存在明显有价值的信息 | “进入会议室，空椅子在右边。” | 不打断 |
| **L4 普通可见信息** | 只是看见某物，没有行动价值 | “墙上有一幅画。” | **默认不说** |

这一个层级已经能解决大量问题。

关键原则是：

> **“可见”不等于“值得播报”。**

---

# 什么时候应该主动播报？

我会要求候选信息至少满足下面这些条件中的多数，而且有两个是硬条件：

```text
                 candidate event
                       │
                       ▼
              ① 信息够新鲜吗？
                       │ NO
                       └────→ SILENCE

                       YES
                       ↓
              ② 置信度够高吗？
                       │ NO
                       └────→ SILENCE / 再观察

                       YES
                       ↓
              ③ 用户已经知道吗？
                       │ YES
                       └────→ SILENCE

                       NO
                       ↓
              ④ 与当前任务相关吗？
                       │
                YES────┼────NO
                 ↓           ↓
              高优先级      ⑤ 是否重要到
                            值得主动打断？
                              │
                        NO────┴────→ SILENCE
                              │
                             YES
                              ↓
                         ⑥ 当前适合说吗？
                              ↓
                            SPEAK
```

换成你们产品里的语言，就是五个主要因素：

\[
Utility =
f(
Urgency,\,
TaskRelevance,\,
Novelty,\,
Freshness,\,
Confidence,\,
InterruptCost
)
\]

不是要求真的训练一个模型算这个公式。第一版完全可以是规则。

---

# 场景一：用户只是正常走动，没有明确任务

这是最容易“话痨”的模式。

相机可能不断识别：

> 人、车、树、门、桌子、商店、招牌……

**绝大多数都不应该播报。**

比如：

```text
看见：
桌子
椅子
垃圾桶
路灯
墙
三个人
```

全部：

> SILENCE

但如果发生：

```text
普通办公室走廊
↓
用户走进一个完全新的空间
↓
检测到场景稳定
```

可以主动说一次：

> “进入一个开放办公区，右边有一排桌子。”

然后闭嘴。

也就是说环境描述应该是：

> **scene-transition triggered**

而不是：

> periodic description

这会比每15秒描述一次自然很多。

---

# 场景二：用户正在“找钥匙”

这时候播报策略完全不同。

系统内部：

```text
TASK = FIND(keys)
```

于是：

> 椅子 → 不重要  
> 杯子 → 除非作为 landmark，否则不重要  
> 钥匙 → 极高优先级

例如：

```text
Frame 1:
没有找到
```

不要：

> “没有找到钥匙。”

继续沉默或者等用户扫视。

```text
Frame 2:
疑似钥匙 confidence .55
```

不要：

> “钥匙在右边。”

可以继续观察。

```text
Frame 3:
同一个候选再次出现
confidence .91
```

这时主动播报：

> “找到钥匙了，在右边。”

用户向右转。

```text
Frame 4:
钥匙现在接近中心
```

主动说：

> “就在正前方。”

用户继续接近。

```text
Frame 5:
目标没有显著变化
```

**沉默。**

这一点特别重要。

不是：

> “还在正前方。”  
> “还在正前方。”  
> “还在正前方。”

而是只在**状态发生有意义变化**时讲话。

---

# 所以我会加入一个核心概念：Novelty

系统一定要记：

```text
last_spoken_fact
```

例如已经说过：

```text
keys = right
```

下一帧还是：

```text
keys = right
```

则：

> SILENCE

只有变化达到阈值：

```text
right → center
```

才：

> “就在正前方。”

或者：

```text
visible → lost
```

如果这对当前任务重要，可以：

> “暂时看不到钥匙了，稍微往左扫。”

这实际上是**事件驱动语言**。

---

# 场景三：用户在读东西

比如拿起一个药盒。

开始的时候系统可能检测：

```text
文本区域
+
手机稳定
+
用户正在近距离看物体
```

不要立即把所有文字念出来。

可以主动说：

> “检测到一个药盒。”

如果用户设置了自动阅读：

> “布洛芬，200毫克。”

然后停止。

除非：

- 用户翻转包装；
- 出现新的重要字段；
- 用户追问。

同一面包装连续出现在30帧里，仍然只应该算**一次事件**。

---

# 场景四：用户排队

这是主动播报特别有价值的情况。

用户可能不需要知道：

> 前面有三个人。

真正重要的是**状态变化**。

比如：

```text
queue_position stable
→ SILENCE
```

过了20秒：

```text
前面的人往前移动
```

播报：

> “队伍往前了。”

然后：

```text
用户还没移动
```

如果过了一小段时间仍没动，可以再：

> “可以向前一步。”

而不是持续描述所有人的衣服、姿势和位置。

这就是：

> **change detection > scene description**

---

# 场景五：进入陌生空间

比如走进会议室。

应该主动播一次：

> “进入一个会议室，桌子在前方，空椅子在右边。”

然后进入沉默。

除非发生：

```text
新的重要对象出现
用户主动问
用户开始寻找特定目标
```

否则不要：

> “还有窗户。”  
> “桌上有电脑。”  
> “墙上有投影仪。”

用户如果想知道可以问。

这里应该遵循：

> **主动播报给 overview；细节按需提供。**

---

# “什么时候绝对应该沉默”其实可以定义得非常明确

我会把 SILENCE 做成真正的一等 action，而不是模型没东西说时的 fallback：

| 情况 | 原因 |
|---|---|
| 与上一条播报实质相同 | 重复 |
| 信息已经明显过时 | stale |
| VLM/视觉置信度不足 | 防止错误指导 |
| 当前图片运动模糊 | 证据差 |
| 用户正在快速转动相机 | 世界还没稳定 |
| 用户正在讲话 | 不打断 |
| TTS 正在播放更高优先级信息 | 避免语音竞争 |
| 只是看到普通物体 | 缺乏行动价值 |
| 信息与当前任务无关 | relevance 低 |
| 已经说过，用户没有表现出需要更新 | novelty 低 |
| 无法压缩成一句明显有用的话 | 信息价值可能不足 |

最后一条其实很实用：

> **如果系统需要讲20秒才能说明为什么这件事值得说，大概率现在不值得主动说。**

---

# 我特别建议增加“Speech Budget”

因为语音对于视障用户不是免费的。

他们还需要听：

- 环境声音；
- 其他人说话；
- 交通声音；
- 自己的 screen reader；
- 导航；
- Agent。

所以可以给不同等级不同 budget。

第一版我甚至会人为规定一些产品参数，例如：

```text
普通环境提示：
最多 1 句话
通常 < 2 秒

非任务相关主动提示：
默认至少间隔 10–20 秒

任务指导：
允许更频繁，
但只有目标状态变化才说

安全警告：
不受 cooldown 限制
```

这些数字不是理论最优值，应该通过用户测试调整；但先有明确 budget 会比让语言模型自由决定好得多。

工作负荷感知系统和 smart-glasses 主动通知研究都强调：通知时机和用户当前认知负荷本身就是系统状态，而不是文本生成后的附属问题。[Kosch, 2020](https://arxiv.org/abs/2010.07703)；[Pu et al., 2025](https://dl.acm.org/doi/abs/10.1145/3746059.3747770)

---

# 还应该有“抑制条件”优先于“播报条件”

例如：

```text
候选事件：
“左边出现了咖啡店”
```

本来 L3，可以说。

但是：

```text
用户正在过马路
```

那么：

> SILENCE

因为当前 auditory channel 比这条信息更珍贵。

再比如：

```text
候选事件：
“你要找的钥匙出现了”
```

优先级 L1。

即使用户正在移动，这可能仍值得说：

> “看到钥匙了，先停一下。”

所以同一个 detection，在不同 context 中 action 可以完全不同。

---

# 你前面提到13秒VLM延迟，这里必须进入播报政策

我会给每一条 candidate event 都带：

```text
captured_at
finished_at
age
```

例如：

```text
VLM:
“右边有一扇门”

capture age = 14s
```

当前用户已经移动：

> 不能播。

这不是：

> 置信度下降。

而应该直接：

> **freshness gate failed → SILENCE**

除非内容属于可以长期成立的类型，比如：

> “刚才进入的是一个厨房。”

这种可以改写成历史信息。

所以：

```text
current claim:
“钥匙在右边。”
```

过时以后不能说。

但可以转成：

```text
memory claim:
“刚才在右边看到过钥匙。”
```

这个 distinction 非常重要。

---

# 我还会强制 Agent 区分“事实”和“行动建议”

例如视觉模型看到：

> 前方有椅子。

系统内部：

```text
FACT:
chair detected ahead
```

未必需要播报。

只有 policy 判断：

```text
chair
+
current task = find seat
```

才变成：

> “前方有一把椅子。”

如果：

```text
chair
+
user is walking toward it
+
fast sensor verifies close obstacle
```

才可能变成：

> “前方有椅子。”

甚至“停”。

**事实层不要直接生成语言动作。**

---

# 第一版完全可以不用训练“播报模型”

我建议甚至不要让 LLM 自己决定：

> 该不该说。

第一版写一个非常可解释的 policy：

```text
IF event.safety_critical
AND event.fresh
AND event.confidence > high:
    SPEAK_NOW

ELSE IF event.matches_current_task
AND event.new
AND event.fresh
AND event.confidence > threshold:
    SPEAK

ELSE IF event.major_scene_transition
AND user_not_busy
AND awareness_cooldown_expired:
    SPEAK

ELSE:
    SILENCE
```

然后 VLM只负责：

```text
视觉理解
→ candidate events
```

policy负责：

```text
candidate events
→ SPEAK / SILENCE
```

最后一个语言模型或者模板负责：

```text
event
→ 一句短话
```

我觉得这个责任分离很重要。

---

# 我会给每个 candidate event 强制要求这些字段

例如：

```json
{
  "event": "target_found",
  "object": "keys",

  "urgency": 0.3,
  "task_relevance": 1.0,
  "confidence": 0.92,
  "freshness": 0.98,
  "novelty": 1.0,

  "actionable": true,
  "suggested_action": "turn_right",

  "observed_at": "...",
  "source": "current_frame"
}
```

第二轮：

```json
{
  "event": "target_found",
  "object": "keys",

  "task_relevance": 1.0,
  "confidence": 0.94,
  "freshness": 0.99,
  "novelty": 0.0
}
```

由于：

```text
novelty = 0
```

直接：

> SILENCE

这样比 prompt：

> “如果你觉得有必要就告诉用户。”

稳定得多。

---

## 最终我认为主动模式的核心原则可以压缩成一句话

> **Agent 不是负责“报告视觉世界”，而是负责“检测一个对用户有意义的状态变化”。**

只有发生：

```text
重要变化
+
当前相关
+
证据新鲜
+
足够确定
+
用户还不知道
```

才播报。

否则：

> **保持沉默。**

这与近年来视障辅助中的 proactive co-pilot、认知负荷管理和 timely assistance 方向是比较一致的。VIABench 甚至已经把“持续观察视频并在需要时主动触发提醒”明确作为视障视觉辅助模型的一类 benchmark task，而不是单纯图像问答。[Liu et al., 2026](https://arxiv.org/abs/2607.14660)

### 相关研究

*Zhao, Y., Wang, S., Geng, Q., Yu, E., & Li, J. (2025). “Less is More”: Reducing Cognitive Load and Task Drift in Real-Time Multimodal Assistive Agents for the Visually Impaired. [arXiv](https://arxiv.org/abs/2511.00945)*

*Cai, R., Janaka, N., Kim, H., Chen, Y., Zhao, S., et al. (2025). AiGet: Transforming Everyday Moments into Hidden Knowledge Discovery with AI Assistance on Smart Glasses. CHI. [ACM](https://dl.acm.org/doi/abs/10.1145/3706598.3713953)*

*Pu, K., Zhang, T., Sendhilnathan, N., Freitag, S., et al. (2025). ProMemAssist: Exploring Timely Proactive Assistance Through Working Memory Modeling in Multi-Modal Wearable Devices. UIST. [ACM](https://dl.acm.org/doi/abs/10.1145/3746059.3747770)*

*Xie, J., Yu, R., Zhang, H., Billah, S. M., Lee, S., et al. (2025). Beyond Visual Perception: Insights from Smartphone Interaction of Visually Impaired Users with Large Multimodal Models. CHI. [ACM](https://dl.acm.org/doi/abs/10.1145/3706598.3714210)*

*Zhao, Y., Kupferstein, E., Rojnirun, H., Findlater, L., & Azenkot, S. (2020). The Effectiveness of Visual and Audio Wayfinding Guidance on Smartglasses for People with Low Vision. CHI. [ACM](https://dl.acm.org/doi/abs/10.1145/3313831.3376516)*

*Kosch, T. (2020). Workload-Aware Systems and Interfaces for Cognitive Augmentation. [arXiv](https://arxiv.org/abs/2010.07703)*

*Matei, M. (2023). An Insight of Adaptive Notification Management and User Experience Intelligent Systems for the Blind. Procedia Computer Science. [ScienceDirect](https://www.sciencedirect.com/science/article/pii/S1877050923014886)*

*Liu, Y., Yang, Y., Han, J., Huang, Z., Tang, Y., et al. (2026). VIABench: A Comprehensive Video Benchmark Collected from Blind Individuals for Visual Impairment Assistance. [arXiv](https://arxiv.org/abs/2607.14660)*

我觉得下一步最值得做的，不是再谈模型，而是把这个主动模式直接写成一张**“事件 → 优先级 → 是否播报 → 冷却时间 → 典型话术”状态表**。这样你们甚至可以立刻把它变成代码。

用户：这个还需要结合VLM输入图片规则以及记忆系统。比如相似图片仅传入一张，重复场景不多次描述。

但是还是有很多问题。绝大多数场景信息其实都是噪声，街边有什么店都与用户无关，很多时候都用户知道自己在哪里。这里我觉得不能只有自动和主动两个模式。可以分为3个甚至多个：沉默（仅危险情况出声）；简要场景描述；具体任务。

对，我觉得你现在这个方向已经比较接近真正的产品形态了：**不是让 Agent 判断“要不要主动”，而是让用户选择一个“视觉注意力级别”，不同级别拥有完全不同的感知、VLM 调用、记忆和播报规则。**

我会先做 **4 个模式**，其中前三个就是你提出的核心模式，第四个用于用户主动想“多看看周围”。

| 模式 | Agent 的角色 | 主动播报什么 | VLM 调用强度 |
|---|---|---|---|
| **安静模式** | 安全哨兵 | 仅高优先级危险/重大变化 | 极低 |
| **环境模式** | 周边意识 | 新场景、重要空间变化，极简 | 低 |
| **任务模式** | 完成具体目标 | 所有与当前目标有关的进展 | 按需、高相关 |
| **探索模式** | 临时“替我看看” | 更丰富的环境、物体、文字描述 | 较高 |

而且我建议：

> **默认是安静模式。**

不是环境模式。

因为你说得很对，大多数视觉信息实际上都是噪声。

用户走在自己每天走的街上时：

> “左边是星巴克。”  
> “前方是便利店。”  
> “旁边有人骑自行车。”  
> “右边有广告牌。”

这些即使全部识别正确，也可能让产品变得不可用。

---

# 1. 安静模式：默认模式

它的原则应该非常严格：

> **除非不说可能明显影响用户，否则闭嘴。**

例如：

```text
普通街道
咖啡店
行人
汽车停在路边
招牌
商场
树
桌椅
```

全部：

> SILENCE

允许主动出声的只有类似：

```text
重要危险
+
证据足够新鲜
+
可靠性足够高
```

例如：

> “停，前方有台阶。”

但这里有一个非常重要的技术边界：

**你们现在 13 秒的云端 VLM 绝对不能承担这个安全通道。**

真正的安全播报应该来自：

```text
本地快速检测 / depth / 手机传感器 / 专门模型
```

而不是慢 VLM。

所以安静模式下甚至可能：

```text
VLM 基本不运行
```

除非用户问问题。

这反而非常省成本。

---

# 2. 环境模式：告诉我“值得知道的变化”

这个模式不是：

> 描述我看到的一切。

而是：

> **当用户的环境发生有意义变化时，给一句 orientation-level information。**

例如：

用户一直在街道上走：

> SILENCE

进入商场：

> “进入一个室内商场空间。”

然后闭嘴。

走进餐厅：

> “进入餐厅，柜台在前方。”

然后闭嘴。

从走廊进入会议室：

> “进入会议室，桌子在前方，座位主要在右侧。”

然后又闭嘴。

因此触发单位不是：

```text
15 秒
```

而是：

```text
Scene A
↓
Scene A
↓
Scene A
↓
Scene A
↓
Scene B  ← 触发一次 VLM / 播报
```

这也是为什么**记忆系统和图像输入规则其实是同一个问题**。

---

# 3. 任务模式：我现在要找/做某件事情

例如：

> “帮我找钥匙。”

一旦进入这个模式：

```text
task = FIND(keys)
```

Agent 的注意力立即收缩。

街边有什么店不重要。

房间是什么风格不重要。

桌上的书是什么不重要。

只有：

```text
keys
可能藏钥匙的位置
有助于定位钥匙的 landmark
```

重要。

这里 VLM 调用可以明显增加，因为任务价值也明显增加。

例如：

> “慢慢向右扫。”

看。

没找到：

> 不说。

继续扫。

疑似目标：

> 不急着播。

下一张确认：

> “看到疑似钥匙，停一下。”

新的清晰照片：

> “找到了，在桌子右侧。”

用户移动：

重新看。

> “现在就在正前方。”

所以这里 Agent 应该像一个**任务执行器**，而不是环境描述器。

---

# 4. 探索模式：用户明确想知道周围有什么

例如用户说：

> “跟我说说这个地方。”

这时候才允许输出：

> “这是一个咖啡馆。柜台在左前方，右侧有几张桌子，大部分座位有人。”

甚至继续：

> “桌上有什么？”

> “菜单写什么？”

这种模式可以持续一分钟，也可以一次描述后自动退出。

我认为它应该是用户明确进入的，而不是系统自作主张。

---

# 这四种模式最关键的区别其实不是 Prompt

而是：

## 什么图片允许进入 VLM？

这个要放在 VLM **前面**。

假设摄像头继续 1 FPS 甚至更高频率抓图。

不要：

```text
frame1
frame2
frame3
frame4
↓
全部发 VLM
```

应该先有一个很轻的：

> **Visual Input Manager**

---

# 第一关：图片质量

例如：

```text
严重运动模糊 → DROP
过暗 → DROP
镜头被遮挡 → DROP
```

除非任务本身必须立即处理。

---

# 第二关：与上一张有没有明显变化

假设：

```text
09:01:00
09:01:01
09:01:02
09:01:03
```

四张照片几乎相同。

只留：

> **最清晰的一张。**

而不是四张一起传。

可以把它理解成：

```text
Scene Cluster 21
 ├── frame 151  blur=.20
 ├── frame 152  blur=.11
 ├── frame 153  blur=.03  ← KEEP
 └── frame 154  blur=.08
```

最后 VLM 只看到：

```text
frame153
```

近期 streaming-video memory 工作里，**near-duplicate suppression、keyframe selection 和把逐帧记忆压缩成 gist/event memory** 本身就是重要问题，而不是默认把所有视频帧交给模型。[Lian et al., 2026](https://aclanthology.org/2026.acl-long.533/)；ActiveEye 也把智能眼镜上的连续视频理解做成选择性处理，而不是逐帧大型模型推理。[Xu et al., 2025](https://dl.acm.org/doi/abs/10.1145/3770641)

---

# 第三关：这个场景以前是不是已经理解过？

例如用户坐在办公室。

VLM 已经在 10:00 说过：

> “你在办公室，桌子在前方。”

10:01：

画面基本没变化。

不要再次调用 VLM。

10:05：

还是同一个地方。

仍然不要。

所以 Memory 里应该有一个：

```text
SceneMemory {
    scene_id: 42
    representative_image
    summary
    spoken_facts
    last_semantic_update
}
```

例如：

```text
scene_42

representative:
office_001.jpg

summary:
small office,
desk ahead,
door behind-right

already_spoken:
"桌子在前方"

last_major_change:
10:00:13
```

如果新照片仍属于 `scene_42`：

> 不需要重新“理解整个场景”。

---

# 但注意：相似画面 ≠ 一定不用分析

这时候**模式**就发挥作用了。

例如两张照片 95% 相似。

在环境模式：

> DROP。

但用户现在说：

> “帮我看看桌面上有没有钥匙。”

那么即使场景没有任何变化：

> **KEEP。**

因为：

```text
visual novelty = low
task relevance = high
```

所以帧选择不能只有：

> similarity threshold。

应该类似：

\[
KeepFrame =
VisualNovelty
\lor
TaskRelevance
\lor
UncertaintyReduction
\]

这非常重要。

---

# 第四关：是否需要多张照片？

你刚才说：

> 相似图片仅传入一张。

我非常赞成。

但应该进一步规定：

> **多张图片必须各自提供不同证据。**

例如：

```text
图1：房间左侧
图2：房间中央
图3：房间右侧
```

值得一起传。

而：

```text
图1：桌面
图2：几乎同一个桌面
图3：还是这个桌面
图4：还是这个桌面
```

通常只需要最清晰的一张。

所以多图输入的规则应该是：

> **最大化 information diversity，而不是 maximize recency。**

---

# Memory 也应该分成三层

这里我觉得特别关键。

## 第一层：Visual Memory

保存：

```text
少量 representative keyframes
```

而不是所有截图。

例如：

```text
厨房：
K17
K21
K25
```

---

## 第二层：Semantic Memory

保存：

> 系统已经知道什么。

例如：

```text
scene_17:
    kitchen
    counter ahead
    fridge left
```

这样下次不用 VLM重新识别整个厨房。

---

## 第三层：Interaction Memory

保存：

> **已经告诉用户什么。**

例如：

```text
spoken:
- "进入厨房"
- "冰箱在左边"
```

这个和 semantic memory 不一样。

系统可能知道：

```text
桌上有杯子
```

但从没告诉用户。

如果用户突然说：

> “我的杯子在哪？”

这条记忆仍然非常有价值。

另一方面已经说过：

> “冰箱在左边。”

就不要十秒钟后再说一次。

---

# 因此“重复场景不多次描述”实际上需要两个去重机制

### 感知去重

> 这是不是同一个场景？

决定：

> 是否重新调用 VLM。

### 语言去重

> 这个事实是不是已经告诉用户了？

决定：

> 是否再次播报。

这两个不要混起来。

例如：

场景没变化：

```text
scene same
```

但目标状态变化：

```text
keys previously absent
keys now detected
```

应该播报。

反过来：

场景明显变化：

```text
new camera angle
```

但语义没有产生用户需要知道的新信息：

> 不播。

---

# 我会再加入一个“用户已知”概念

你指出：

> 很多时候用户知道自己在哪里。

这个特别重要。

例如 GPS / 历史行为知道：

```text
user has been at home for 30 min
```

此时：

> “你在厨房里。”

可能完全没有价值。

所以信息价值不是：

```text
model did not say this before
```

而应该是：

```text
user probably does not already know this
```

虽然这很难精确判断，但第一版可以做得很简单：

如果：

- 用户主动走进这个空间；
- 最近已经有环境描述；
- 场景变化是由用户自己连续动作导致；
- 没有异常；

则 `information_gain_for_user` 很低。

相反：

用户问：

> “这是哪里？”

立刻变高。

ProAgent 最近的工作也明确讨论到，主动助手不能因为有某种上下文就不断触发近重复的 assistance，而应该结合用户需要和场景上下文抑制无用提醒。[Yang et al., 2025](https://arxiv.org/abs/2512.06721)

---

# 所以我会给每条候选信息加一个非常重要的字段

不是：

```text
importance
```

而是：

```text
user_information_gain
```

例如：

| 信息 | 模型觉得重要 | 用户信息增益 |
|---|---:|---:|
| “你在自己家厨房” | 中 | **极低** |
| “你常去的咖啡店在左边” | 中 | 低 |
| “你要找的钥匙出现了” | 高 | **极高** |
| “你进入一个以前没来过的大堂” | 中 | 高 |
| “前面排队的人走了” | 中 | **高** |
| “墙上有一张海报” | 低 | 极低 |

这比单纯 `importance` 有用得多。

---

# 最后可以把四个模式做成不同的阈值

例如内部统一计算：

```text
Safety
TaskRelevance
UserInformationGain
Novelty
Freshness
Confidence
InterruptionCost
```

但模式决定阈值。

### 安静模式

```text
只有：
Safety 很高
```

才说。

---

### 环境模式

允许：

```text
Safety 高
OR
UserInformationGain 高
AND major scene/event change
```

---

### 任务模式

允许：

```text
Safety 高
OR
TaskRelevance 高
AND new actionable information
```

---

### 探索模式

阈值明显降低：

```text
普通场景信息也可以说
```

因为用户已经主动表达：

> “我现在想知道更多。”

---

# 模式最好主要由用户决定，而不是 Agent 随便升级

这一点我会非常保守。

可以允许：

```text
用户：“帮我找钥匙。”
→ 自动进入任务模式
```

任务完成：

> “找到了。”

自动退回之前模式。

用户：

> “跟我描述一下这里。”

进入探索/环境增强模式。

描述结束以后退回。

但系统不应该突然从：

> 安静模式

自行升级成：

> “我现在决定详细告诉你街边有什么。”

**唯一可以无条件突破模式的应该是可靠的安全事件。**

这样用户始终控制自己想被打扰到什么程度。

---

# 我会把整个系统变成这样

```text
                    USER MODE
          Quiet / Awareness / Task / Explore
                         │
                         ▼
CAMERA ───────→ Frame Gate
               blur?
               duplicate?
               stable?
               task relevant?
                         │
                         ▼
                  Scene Memory
                same scene?
                known scene?
                representative frame?
                         │
                         ▼
                    VLM INPUT
             只发送真正需要的图片
                         │
                         ▼
                Candidate Facts
                         │
                         ▼
                Interaction Memory
             这件事已经说过了吗？
             用户大概率已经知道吗？
                         │
                         ▼
                  Mode Policy
                         │
             ┌───────────┴───────────┐
             ▼                       ▼
           SPEAK                   SILENCE
```

我觉得这已经是一个非常清晰的产品架构。

尤其是它把三个现在很容易混在一起的问题彻底分开了：

> **要不要拍/保留这张图？**

> **要不要让 VLM 分析这张图？**

> **即使 VLM 得到了信息，要不要告诉用户？**

这三个答案完全可以分别是：

```text
保留：YES
分析：YES
播报：NO
```

例如把某个场景写入记忆，但用户当前并不需要听。

或者：

```text
保留：NO
分析：NO
播报：NO
```

相似重复帧。

也可以：

```text
保留：YES
分析：YES
播报：YES
```

任务目标第一次出现。

---

## 我会先把产品做到这四档，而不是让 Agent 自己“智能决定一切”

**安静**——“除非真的需要我知道，否则不要说话。”

**环境**——“如果我的周围发生值得注意的变化，简短告诉我。”

**任务**——“我现在正在做一件具体的事，只告诉我与这件事有关的东西。”

**探索**——“我现在想多了解周围，请主动告诉我更多。”

这种模式划分的价值在于，**同一套视觉识别结果在不同模式下可以产生完全不同的行为**。它既能控制 VLM 成本，也能控制认知负担，还能让“沉默”成为用户明确选择的一种产品行为，而不是模型恰好没说话。

近年的研究整体上也支持这种方向：视障实时助手需要控制认知负担和 task drift，[Zhao et al., 2025](https://arxiv.org/abs/2511.00945)；智能眼镜连续理解系统开始采用选择性、事件驱动的视频处理，[Xu et al., 2025](https://dl.acm.org/doi/abs/10.1145/3770641)；长时第一人称视频 agent 则越来越依赖 near-duplicate suppression、关键帧和压缩记忆，而不是保存每帧。[Lian et al., 2026](https://aclanthology.org/2026.acl-long.533/)

### 相关研究

*Zhao, Y., Wang, S., Geng, Q., Yu, E., & Li, J. (2025). “Less is More”: Reducing Cognitive Load and Task Drift in Real-Time Multimodal Assistive Agents for the Visually Impaired. [arXiv](https://arxiv.org/abs/2511.00945)*

*Xu, Z., Lu, T., Zhao, Y., Wang, Y., Dong, M., et al. (2025). ActiveEye: Enabling Continuous and Responsive Video Understanding for Smart Eyewear Systems. Proceedings of the ACM on Interactive, Mobile, Wearable and Ubiquitous Technologies. [ACM](https://dl.acm.org/doi/abs/10.1145/3770641)*

*Yang, B., Xu, L., Zeng, L., Guo, Y., Jiang, S., et al. (2025). ProAgent: Harnessing On-Demand Sensory Contexts for Proactive LLM Agent Systems in the Wild. [arXiv](https://arxiv.org/abs/2512.06721)*

*Lian, N., Wang, Y., Yao, H., Wang, J., Chen, B., et al. (2026). From Verbatim to Gist: Distilling Pyramidal Multimodal Memory via Semantic Information Bottleneck for Long-Horizon Video Agents. ACL. [ACL](https://aclanthology.org/2026.acl-long.533/)*

*Milford, M., & Fischer, T. (2025). Going Places: Place Recognition in Artificial and Natural Systems. Annual Review of Control, Robotics, and Autonomous Systems. [Annual Reviews](https://www.annualreviews.org/content/journals/10.1146/annurev-control-032724-014418)*

*Zhou, S., Xiao, J., Li, Q., Li, Y., Yang, X., et al. (2025). EgoTextVQA: Towards Egocentric Scene-Text Aware Video Question Answering. CVPR. [IEEE](https://ieeexplore.ieee.org/abstract/document/11094616/)*

*Huh, M., Xue, Z., Das, U., Ashutosh, K., Grauman, K., et al. (2025). Vid2Coach: Transforming How-To Videos into Task Assistants. UIST. [ACM](https://dl.acm.org/doi/abs/10.1145/3746059.3747612)*

*Kwok, T. C. K., Kiefer, P., & Raubal, M. (2024). Unobtrusive Interaction: A Systematic Literature Review and Expert Survey. Human–Computer Interaction. [Taylor & Francis](https://www.tandfonline.com/doi/abs/10.1080/07370024.2022.2162404)*

下一步其实已经可以直接写成规格：**四种模式分别对应什么 Frame Gate、什么 Memory TTL、最多给 VLM 几张图、哪些事件允许播报、重复信息多久内不得再说。** 这张表一旦定下来，就基本是第一版 Agent 的产品逻辑。

用户：可以，把这四个模式写清楚

GPT：
可以。我会把这四个模式定义成四种不同的**注意力策略**，而不只是四套 prompt。模式同时控制：

**摄像头哪些画面值得保留 → 哪些图片值得送 VLM → VLM 应该关注什么 → 记忆保存什么 → 什么条件下允许说话。**

整体原则是：**模式越往后，系统越愿意花视觉计算和用户注意力；默认模式应该最保守。** 这也比较符合智能眼镜、主动辅助和视障视觉辅助研究中反复出现的结论：持续描述往往不是目标，关键是选择性处理视频、降低认知负担，并只在有价值的时机介入。[Xu et al., 2025](https://dl.acm.org/doi/abs/10.1145/3770641)；[Ning et al., 2025](https://dl.acm.org/doi/abs/10.1145/3746059.3747650)

## 四种模式的正式定义

| | ① 安静模式 | ② 环境模式 | ③ 任务模式 | ④ 探索模式 |
|---|---|---|---|---|
| 用户意图 | “除非必要，别打扰我” | “有值得知道的环境变化时告诉我” | “帮我完成这件事” | “帮我仔细看看周围” |
| 默认状态 | **建议默认** | 用户主动开启 | 有具体任务时自动进入 | 用户临时开启 |
| VLM 调用 | 极少 | 事件触发、低频 | 与任务相关时积极调用 | 较积极 |
| VLM 主要看什么 | 用户主动问的问题 | 新场景/明显变化 | 与目标有关的局部画面 | 整体环境及细节 |
| 每次图片数 | 通常 0–1 | 通常 1 | 1–3 张互补图 | 1–4 张互补图 |
| 主动播报 | 仅可靠的高优先级事件 | 简要场景变化 | 任务进展和下一步指导 | 较丰富描述 |
| 无关信息 | 全部忽略 | 基本忽略 | **严格忽略** | 可以适量描述 |
| 重复场景 | 不分析 | 不重复描述 | 除非任务需要，否则不分析 | 可重新观察细节 |
| 记忆重点 | 最近关键帧 | 场景摘要 | 任务状态、候选目标 | 更丰富的视觉记忆 |
| 说话频率 | 极低 | 低 | 根据任务变化 | 中等 |
| 自动结束 | — | 用户切换 | **任务完成即退出** | 一次探索结束后退出 |

下面分别展开。

---

# ① 安静模式：视觉守望

它的产品承诺应该非常清楚：

> **“我一直在看，但绝大多数时候不会说话。”**

这是我建议的默认模式。

### 相机和 VLM

摄像头仍然可以持续运行，系统也仍然可以进行非常便宜的：

`运动状态 → 模糊检测 → 图片相似度 → 关键帧选择`

但**场景变化本身并不足以触发 VLM**。

例如用户每天走过熟悉街道：

```text
咖啡店
↓
便利店
↓
路口
↓
办公楼
```

全部可以：

> 不调用 VLM，不播报。

只有两类事情例外。

第一类是用户主动问：

> “前面是什么？”

这时立即取当前最清晰照片调用 VLM。

第二类是安全系统产生足够可靠的高优先级事件。

但这里必须强调：

> **13 秒 VLM 不能承担即时安全检测。**

真正的“停、前面有台阶”之类信息必须来自未来更快的本地感知模块。VLM只能辅助确认不那么时间敏感的事情。

### 记忆

安静模式可以留下非常少的 representative keyframes：

```text
scene_17 → representative.jpg
scene_18 → representative.jpg
```

不急着做语义分析。

这意味着：

> “保存一张有可能以后有用的照片”

和

> “现在花钱让 VLM 理解它”

是两件不同的事。

### 什么时候说？

原则上：

\[
Speak = SafetyCritical
\]

否则：

> SILENCE。

---

# ② 环境模式：简要环境意识

用户的意思是：

> **“不用什么都说，但如果环境发生了值得我知道的变化，就告诉我。”**

这与现在很多所谓“持续场景描述”应该有很大区别。

## VLM 不按时间触发，而按 Scene Transition 触发

例如：

```text
街道 A
A
A
A
A
↓
进入建筑
↓
室内大厅 B
```

不是每 15 秒调用一次。

而是在系统判断：

> **这是一个新的有意义场景。**

然后等待相机短暂稳定，从这个场景最近几张照片里挑：

> **最清晰、最具有代表性的一张。**

发给 VLM。

例如输入：

```text
用户处于“环境模式”。

请只报告一个对视障用户有明显环境价值的新变化。
不要描述商店、广告、装饰、普通行人等无关信息。
如果没有值得主动报告的信息，返回 NO_EVENT。
```

可能得到：

> “从室外进入了一个大型室内大厅，服务台在前方。”

Agent再压缩成：

> “进入一个大厅，服务台在前方。”

然后这个信息进入：

```text
spoken_memory
```

同一大厅以后即使摄像头转来转去：

> 不再说“这是大厅”。

---

## 环境模式到底关注什么？

我认为应该优先关注**结构变化**而不是“有什么东西”。

例如：

高价值：

> 室外 → 室内  
> 走廊 → 开放大厅  
> 普通地面 → 楼梯区域  
> 进入餐厅/会议室/车站  
> 排队状态发生变化  
> 新出现一个明显与行动有关的入口/柜台

通常低价值：

> “左边有星巴克。”  
> “路边停着一辆白色汽车。”  
> “墙上有广告。”  
> “一个穿蓝衣服的人走过去。”

尤其你提到：

> 用户往往知道自己在哪里。

所以“场景类别发生变化”也不一定意味着用户需要知道。

最好再经过一个：

\[
UserInformationGain
\]

判断。

例如用户自己从家里厨房走到客厅：

> 大概率知道，不说。

进入陌生酒店大厅：

> 信息增益可能较高，可以说。

---

# ③ 任务模式：围绕一个具体目标工作

这是四种模式里面 Agent 性最强的。

用户说：

> “帮我找钥匙。”

系统自动创建：

```text
task:
    type = FIND
    target = keys
    state = SEARCHING
```

此时几乎整个感知系统都应该围绕：

> **keys**

重新配置。

### VLM 输入规则发生变化

哪怕两张图视觉上非常相似，只要：

> 用户仍然在搜索钥匙

就可能值得重新分析。

相反，即使场景发生巨大变化：

> 出现了一家新店  
> 新进来几个人

只要与钥匙无关：

> 忽略。

所以任务模式的 Frame Gate 不是：

\[
VisualNovelty
\]

而主要是：

\[
TaskRelevance
\]

---

## 任务最好有明确状态机

例如找物：

```text
SEARCHING
   ↓
CANDIDATE_FOUND
   ↓
VERIFYING
   ↓
CONFIRMED
   ↓
GUIDING
   ↓
DONE
```

语言只在状态变化的时候发生。

例如：

`SEARCHING`

用户慢慢扫视。

没有目标：

> 沉默。

---

`CANDIDATE_FOUND`

模型第一次发现疑似钥匙，置信度一般。

> 仍然沉默，等待另一张图确认。

---

`VERIFYING → CONFIRMED`

第二次确认。

> “找到钥匙了，在右边。”

---

用户转头。

目标由：

`right → center`

> “现在就在正前方。”

---

接下来三张照片目标都在 center：

> 沉默。

---

任务完成：

> “就是这个。”

然后：

> **自动退出任务模式，回到进入任务之前的模式。**

这是非常重要的。

否则“找钥匙”结束后系统仍然使用高频 VLM，会非常浪费。

---

## 任务模式的记忆也是单独的

例如：

```text
TaskMemory

target:
    keys

candidate_images:
    crop_37
    crop_41

last_known_location:
    right

last_instruction:
    "向右一点"

already_spoken:
    target_found
```

这样新一轮模型看到钥匙时，就不会再次：

> “我找到钥匙了！”

而是知道应该给**下一步进展**。

类似任务导向、主动反馈和减少无关信息的设计已经开始出现在针对 BLV 用户的料理、操作辅助和 how-to task assistant 研究中。[Ning et al., 2025](https://dl.acm.org/doi/abs/10.1145/3746059.3747650)；[Huh et al., 2025](https://dl.acm.org/doi/abs/10.1145/3746059.3747612)

---

# ④ 探索模式：现在替我多看看

用户明确表达：

> “告诉我这里有什么。”

或者：

> “我想了解一下周围。”

这时候可以暂时放松 information threshold。

例如用户第一次进入一个酒店房间。

环境模式可能只说：

> “进入一间卧室，床在前方。”

探索模式则可以说：

> “这是一个酒店房间。床在前方，右侧有书桌和椅子，左前方是卫生间入口。”

接着用户可以问：

> “桌上有什么？”

> “窗户在哪？”

> “有没有插座？”

---

## 多图在这里才特别有意义

探索模式可以主动收集几个不同方向的画面：

```text
左侧      正前      右侧
 image1   image2    image3
```

然后一次 VLM 请求：

> 综合描述。

但如果三个画面实际上都是：

```text
同一张桌子
同一张桌子
同一张桌子
```

仍然只传最清楚的一张。

所以多图原则始终应该是：

> **多样性，而不是数量。**

---

## 探索模式最好是临时模式

我不会建议用户一直开着。

可以设计为：

> “看看周围。”

进入探索。

完成一轮 description 或几十秒以后：

> 自动返回之前模式。

否则它很容易变成一个不停讲话的 captioning system。

---

# 四种模式共享同一个 Frame Gate

这是整个系统比较关键的一块。

摄像头不直接通向 VLM：

```text
Camera
  ↓
Frame Buffer
  ↓
Quality Gate
  ↓
Similarity Gate
  ↓
Scene / Task Gate
  ↓
VLM
```

### Quality Gate

淘汰：

```text
严重模糊
曝光严重错误
被遮挡
```

### Similarity Gate

最近多张照片：

```text
F1 ≈ F2 ≈ F3 ≈ F4
```

只保留：

> 最清晰的一张。

### Scene Gate

环境/探索模式：

> 有没有新的场景信息？

### Task Gate

任务模式：

> 有没有可能影响当前任务？

所以同样一张照片：

```text
安静模式：
DROP

环境模式：
如果是已知场景 → DROP

任务模式：
如果里面可能有钥匙 → KEEP

探索模式：
如果提供新的视角 → KEEP
```

模式因此是在 **VLM之前** 就产生影响。

---

# Memory 则必须至少分三类

我会明确区分：

### Visual Memory

> 我看过哪些代表性画面？

```text
scene_17:
    representative.jpg
```

用于判断：

> “这个地方之前见过吗？”

---

### Semantic Memory

> 我已经理解了什么？

```text
scene_17:
    indoor lobby
    counter ahead
    chairs right
```

这样再次回来不用重新 VLM 描述整个场景。

---

### Interaction Memory

> 我已经告诉用户什么？

```text
spoken:
    "进入一个大厅"
    "服务台在前方"
```

这是防止“话痨”的最重要记忆。

因为：

> 系统知道 ≠ 用户已经知道。

反过来：

> 用户已经被告知 ≠ 下一次还值得说。

---

# 然后所有模式最后共用一个播报门

我会让每个 VLM 结果先成为：

```text
CandidateFact
```

而不是直接生成 TTS。

例如：

```text
fact:
    target = keys
    position = right

confidence = HIGH
freshness = HIGH
novelty = HIGH

task_relevance = VERY_HIGH

already_spoken = false
```

然后 policy 才判断。

可以把核心逻辑压成：

\[
Speak
=
Fresh
\land
Confident
\land
NotRepeated
\land
AllowedByMode
\]

其中 `AllowedByMode`：

```text
QUIET
→ 只有 Safety

AWARENESS
→ Safety / high UserInformationGain

TASK
→ Safety / high TaskRelevance

EXPLORE
→ Safety / useful scene information
```

这样你不需要为四个模式写四套完全不同系统。

实际上是：

> **同一个视觉系统 + 同一个记忆系统 + 四套门槛。**

---

# 一个完整例子会很直观

用户从办公室出门去找洗手间。

初始：

> **安静模式**

沿熟悉走廊走。

Agent：

> 沉默。

用户：

> “告诉我周围环境。”

切：

> **环境模式**

进入一个陌生大厅。

代表帧 → VLM。

Agent：

> “进入一个大厅，前方有服务台。”

之后看了十几张类似画面。

> 全部去重，沉默。

用户：

> “帮我找洗手间。”

自动进入：

> **任务模式**

所有普通商店、行人、装饰：

> 忽略。

看到卫生间标志候选：

> 暂时不说。

下一张确认：

> “看到洗手间标志，在右边。”

用户转右。

> “现在标志在正前方。”

到达。

> “入口就在前方。”

任务完成。

自动返回：

> **环境模式**

用户走进去以后如果说：

> “这里是什么布局？”

进入：

> **探索模式**

Agent可以提供更详细的场景信息。

这四种模式配合起来之后，Agent才开始像一个**用户能够控制注意力的视觉助手**，而不是一个始终在直播摄像头内容的 AI。

我会把这四个模式最终命名得非常简单：

**安静**：只有必要时说。  
**环境**：告诉我值得知道的环境变化。  
**任务**：只关注我正在做的事。  
**探索**：现在替我多看看。

其中有一个产品原则我会坚持：

> **安静是默认权利；更多视觉描述是用户主动授予 Agent 的注意力预算。**

这可能比“AI 能识别多少东西”更决定这个产品实际是否愿意被长期佩戴。

### 参考研究

*Xu, Z., Lu, T., Zhao, Y., Wang, Y., Dong, M., et al. (2025). ActiveEye: Enabling Continuous and Responsive Video Understanding for Smart Eyewear Systems. Proceedings of the ACM on Interactive, Mobile, Wearable and Ubiquitous Technologies. [ACM](https://dl.acm.org/doi/abs/10.1145/3770641)*

*Ning, Z., Li, L., Killough, D., Seo, J. Y., Carrington, P., et al. (2025). AROMA: Mixed-Initiative AI Assistance for Non-Visual Cooking by Grounding Multimodal Information Between Reality and Videos. UIST. [ACM](https://dl.acm.org/doi/abs/10.1145/3746059.3747650)*

*Huh, M., Xue, Z., Das, U., Ashutosh, K., Grauman, K., et al. (2025). Vid2Coach: Transforming How-To Videos into Task Assistants. UIST. [ACM](https://dl.acm.org/doi/abs/10.1145/3746059.3747612)*

*Xie, J., Yu, R., Zhang, H., Billah, S. M., Lee, S., et al. (2025). Beyond Visual Perception: Insights from Smartphone Interaction of Visually Impaired Users with Large Multimodal Models. CHI. [ACM](https://dl.acm.org/doi/abs/10.1145/3706598.3714210)*

*Chang, R. C., Natalie, R., Xu, W., Yap, J. Z. F., et al. (2025). Probing the Gaps in ChatGPT's Live Video Chat for Real-World Assistance for People Who Are Blind or Visually Impaired. ASSETS. [ACM](https://dl.acm.org/doi/abs/10.1145/3663547.3746319)*

*Brady, E., Morris, M. R., Zhong, Y., White, S., & Bigham, J. P. (2013). Visual Challenges in the Everyday Lives of Blind People. CHI. [ACM](https://dl.acm.org/doi/abs/10.1145/2470654.2481291)*

*Gamage, B., Do, T. T., Price, N. S. C., Lowery, A., et al. (2023). What Do Blind and Low-Vision People Really Want from Assistive Smart Devices? ASSETS. [ACM](https://dl.acm.org/doi/abs/10.1145/3597638.3608955)*

*Pu, K., Zhang, T., Sendhilnathan, N., Freitag, S., et al. (2025). ProMemAssist: Exploring Timely Proactive Assistance Through Working Memory Modeling in Multi-Modal Wearable Devices. UIST. [ACM](https://dl.acm.org/doi/abs/10.1145/3746059.3747770)*