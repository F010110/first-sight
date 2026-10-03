看完这版架构后，我觉得它已经有一个很好的“骨架”：**抓拍、是否调用模型、更新状态、是否输出**被明确拆开了；请求不无限排队，Task 也能压过自动观察。这些都是对的。:chatgpt-content-reference{index="0"}

但如果从视障人士真实生活倒推，当前最大的结构性问题不是 Qwen，也不是 13 秒延迟，而是：

> **现在系统主要在判断“画面有没有变化”，而真正需要判断的是“用户现在有没有获得新的、有行动价值的视觉信息”。**

这两者差别很大。

---

## 用几个真实生活场景来压力测试

| 真实情境 | 用户真正困难 | 当前架构会怎样 | 结果 | 暴露的问题 |
|---|---|---|---|---|
| **每天走熟悉路线去公司** | 不需要别人不断告诉他路边有什么，只希望必要时提醒 | Quiet；转头/场景变化后可能静默调用 Qwen；稳定场景 30 秒还会刷新 | **行为上安静是对的，但感知浪费** | 系统不知道“用户已经知道这里”，没有 familiarity / user knowledge |
| **第一次进入陌生酒店大堂** | 想迅速知道“这是怎样的空间、柜台/入口在哪里” | 默认仍是 Quiet；模型可能更新场景，但不会说 | **基本帮不上忙** | 缺真正可用的 Awareness/环境模式；当前 Awareness 没有 UI 路由 |
| **桌上一堆杂物里找钥匙** | 需要“扫哪里 → 发现候选 → 停下来确认 → 再修正” | Task + deep，之后 Task economy；画面变化才可能继续提示 | **能识别一次，但还不像持续助手** | 缺任务状态机、视觉 grounding、候选确认、补充视角请求 |
| **拿药盒读药名/剂量** | 需要抓到一张清晰照片，快速读关键文字 | Task + deep，最多4帧，按时间抽样 | **可能能用，但方法低效** | 没有清晰度筛选，可能把糊图和近重复图送进去；不需要4张时仍可能送多张 |
| **排队时等前面的人移动** | 不需要持续描述，只希望“队伍开始往前了” | 无任务时 Quiet；Awareness 条件监控未实现 | **不能真正解决** | 缺“watch condition”：监视一个具体事件直到发生 |
| **等电梯门打开 / 等红绿灯状态改变** | 这是典型“告诉我什么时候发生 X” | 与上面类似 | **核心能力缺失** | “变化检测”不等于“语义事件检测” |
| **在会议中想知道“有人走到我面前了吗？”** | 需要特定社会事件，而不是场景 caption | 只能每次主动问，或硬塞成 Task | **比较别扭** | 缺条件型持续关注；也缺“用户知道什么”的记忆 |
| **走路中突然出现台阶/障碍** | 需要亚秒至低秒级提醒 | 当前没有独立安全链，Qwen太慢 | **不能承担** | 安全必须是另一条低延迟通路，不能混进现在的 VLM Agent |
| **刚才看见钥匙，现在看不到了，问“刚才在哪？”** | 需要历史视觉记忆 | 当前 Working Memory 只存语义实体/事件，不会自动检索历史关键帧 | **回答能力很弱** | 缺真正的 visual memory |

这些情景和 BLV 用户研究里反复出现的问题很一致：找物、最后几米定位、购物、读文字、空间理解以及社会/动态环境中的视觉信息都很重要，而且实际困难往往不是“识别不了类别”，而是**持续任务中的定位、时机、反馈和错误恢复**。[Brady et al., 2013](https://dl.acm.org/doi/abs/10.1145/2470654.2481291)；[Szpiro et al., 2016](https://dl.acm.org/doi/abs/10.1145/2971648.2971723)；[Chang et al., 2025](https://dl.acm.org/doi/abs/10.1145/3663547.3746319)

---

# 第一个主要问题：Router 把“像素变化”当成“值得理解的变化”

现在 Router 很清楚：

> 不稳定 → 等  
> 稳定 → 比较灰度签名  
> 差异 > 0.10 → 调模型

这个机制非常适合**节流**，但不应该承担真正的 Attention Router。

因为现实里会有四种完全不同的情况：

```text
视觉变化很大 + 对用户没意义
用户走过一家店、路过一个人

视觉变化很小 + 对用户极重要
电梯门从关变开
红灯变绿
药盒上露出了剂量数字
杂物堆里钥匙刚进入一个小角落

视觉基本不变 + 用户突然产生新需求
“桌面上有没有我的药？”

视觉一直剧烈变化 + 正是用户需要的信息
用户正在扫视寻找钥匙
```

当前架构尤其对最后一种不友好：**运动期间主动等待稳定**本身合理，但找物时“用户正在怎么扫”就是任务进展的一部分。

所以我不会删除现在这个 Router。

我会把它降级成：

> **Frame acquisition / cost-control router**

它负责：

> 现在有没有值得留下的一张图？

而不是负责：

> 现在有没有值得 Agent 理解的事件？

后者必须由模式 + 任务 + 记忆共同决定。

---

# 第二个问题：现在有 Working Memory，但还没有“用户记忆”

这是我认为第二大的问题。

当前 Working Memory 保存：

> 当前 task  
> 最近 scene  
> change events  
> entities  
> 最近播报

这已经比无状态 VLM 好很多。:chatgpt-content-reference{index="1"}

但它回答的是：

> **系统知道什么？**

真正决定主动播报的是另外一个问题：

> **用户可能已经知道什么？**

比如用户从卧室走进自己厨房。

系统检测：

> `scene_changed = true`

模型识别：

> `kitchen`

但是用户当然知道自己走进厨房。

这个事实：

- 对模型来说是新信息；
- 对系统 scene memory 来说也是变化；
- 对用户来说信息增益接近 0。

因此你需要一个现在架构里还没有的一等变量：

\[
UserInformationGain
\]

它比 `changed` 更重要。

这会直接解决你前面说的：

> “街边有什么店基本都是噪声。”

不是店铺不重要，而是**在当前上下文中，它没有给用户增加有用知识**。

“Less is More”这类近期视障辅助研究也指出，实时辅助系统容易发生 cognitive load 和 task drift；大量正确但无关的信息仍然可能降低实际任务表现。[Zhao et al., 2025](https://arxiv.org/abs/2511.00945)

---

# 第三个问题：Frame Gate 目前其实不是“视觉 Frame Gate”

现在服务端的 Frame Gate 做：

> 时间戳去重 + 超预算后均匀抽样。

这从工程上能限制 payload，但它还没有真正回答：

> **哪张图片视觉信息最好？**

文档自己也明确列出，目前没有：

> 清晰度、遮挡、运动模糊、语义相似度筛图。:chatgpt-content-reference{index="2"}

这会直接影响日常使用。

例如读药盒：

```text
F1 糊
F2 糊
F3 非常清楚
F4 清楚但几乎和F3一样
```

现在可能：

> F1 + F2 + F3 + F4 → Qwen

真正应该：

> **只发 F3。**

而找房间布局：

```text
F1 左侧
F2 中间
F3 右侧
```

虽然三张差异都大：

> **三张都值得发。**

所以真正的 Frame Gate 应该优化：

\[
Quality + Diversity + TaskValue
\]

而不是时间分布。

这一个改动很可能同时：

- 降低上传量；
- 降低视觉 token；
- 降低推理时间；
- 提高 VLM准确率。

---

# 第四个问题：Task 现在是一个“字符串目标”，还不是任务状态机

这是找物场景里最明显的问题。

现在可以保存：

> `goal = 帮我找钥匙`

模型也必须输出 `goalRelevant=true` 才能通过策略。

这是好的。

但“找钥匙”其实不是一个静态目标，而是一系列状态：

```text
SEARCHING
   ↓
POSSIBLE_TARGET
   ↓
NEED_BETTER_VIEW
   ↓
CONFIRMED
   ↓
GUIDING
   ↓
LOST
   ↓
REACQUIRED
   ↓
DONE
```

现在系统只有：

> task exists / task ended

没有中间状态。:chatgpt-content-reference{index="3"}

因此模型发现一个低置信度候选以后，策略只能：

> 说 / 沉默

不能：

> **“这张不够清楚，继续看。”**

或者内部决定：

> 再等一帧确认，不要告诉用户。

更重要的是，现在 `clarify` 虽然还在类型里，策略实际上不会产生它；证据不足就是沉默。:chatgpt-content-reference{index="4"}

这对自动模式还好，对用户主动求助很糟糕。

用户：

> “帮我找钥匙。”

系统：

> ……

用户不知道究竟：

- 没找到；
- 模型正在算；
- 图太糊；
- 需要转头；
- 还是程序坏了。

所以 Task 最终至少应该有四种内部 action：

```text
SPEAK
SILENCE
REOBSERVE
ASK_FOR_VIEW
```

这里的 `ASK_FOR_VIEW` 可能最终才生成：

> “慢慢向右扫一下。”

---

# 第五个问题：你实际上最缺的模式不是 Explore，而是 Watch

这一点我看完整架构以后感觉比前面更强烈。

你现在已经有：

> Quiet  
> Awareness  
> Task  
> Explore

但 Awareness 目前没有真正实现关注条件。:chatgpt-content-reference{index="5"}

而现实生活里有一大类特别适合智能眼镜的任务就是：

> **“帮我盯着，发生 X 的时候告诉我。”**

例如：

> “排队的人开始动时告诉我。”  
> “电梯门开了告诉我。”  
> “看到 12 路公交车告诉我。”  
> “看到我的朋友过来告诉我。”  
> “烤箱上的数字变成 0 告诉我。”  
> “这个按钮亮了告诉我。”

这其实不是环境 Awareness，也不是普通 Find Task。

它是一种：

\[
WATCH(condition)
\]

然后：

```text
没有发生
→ 沉默

疑似发生
→ 再确认

确认发生
→ 播报一次

之后
→ task complete / re-arm
```

你现有架构中的 Awareness 类型其实非常适合直接演化成这个。

我甚至不会把 Awareness 定义成：

> “环境变化告诉我。”

而会定义成：

> **“持续关注我明确指定的一种变化。”**

这比泛泛的“环境模式”产品价值更清楚。

---

# 第六个问题：30 秒 Quiet refresh 很可能没有必要

现在：

> 场景稳定 30 秒，也会尝试一次 `stale_state_fallback`。

这对调试很方便。

但从产品角度：

用户坐在自己的办公室一小时：

```text
30s
Qwen

30s
Qwen

30s
Qwen
...
```

尽管完全不播报。

这是典型的：

> **模型成本存在，但用户价值为零。**

如果真正建立 scene memory：

```text
same scene
+
nothing task-relevant changed
+
no watch condition
```

Quiet 完全可以几分钟甚至无限期不调用 VLM。

直到：

- 用户提问；
- 场景有明显新变化；
- 新 Task；
- Watch 条件需要检查；
- 低延迟安全系统触发候选事件。

所以我认为 `30s stale_state_fallback` 更适合：

> 实验 harness

而不是最终 Agent policy。

---

# 第七个问题：目前“新鲜度”定义还比较模型中心

你现在 Task 可以接受最长 90 秒的证据年龄，Explore 是 120 秒。:chatgpt-content-reference{index="6"}

这个参数作为数据完整性检查没有问题。

但从用户提示角度：

> “90 秒前看到钥匙在右边”

完全不能作为：

> “钥匙在右边。”

甚至 13 秒都有问题。

所以 freshness 最终不能只由 Attention Mode 决定，还必须由 **Fact Type** 决定。

例如：

```text
“这是厨房”
TTL 可以很长

“桌上有一台电脑”
TTL 中等

“钥匙在画面右侧”
TTL 很短

“这个人站在前面”
TTL 极短

“门开着”
TTL 极短
```

也就是说需要：

\[
TTL = f(event\_type, mobility, task)
\]

而不是：

\[
TTL = f(mode)
\]

这个变化很重要。

---

# 第八个问题：四模式现在存在于类型里，但没有真正贯穿模型输入

文档里一个很关键的细节是：

> 所有 Attention Mode 共用同一份概括性系统提示词，模式不会作为详细指令交给模型。:chatgpt-content-reference{index="7"}

因此你现在实际上是在：

> **模型先尽量理解 → policy 后面再过滤。**

这会浪费很多模型能力。

例如 Task：

> “找钥匙。”

模型应该从一开始就进入：

> 只检查钥匙和有助于寻找钥匙的证据。

而不是正常理解整个环境以后，再依靠 `goalRelevant` 把东西过滤掉。

同样 Explore 和 Quiet 对模型的 perception objective 也应该不同。

所以模式最终必须同时进入三个地方：

```text
Frame selection
VLM perception prompt
Output policy
```

而现在主要落实在：

> frame budget + output policy。

中间一层还没有真正模式化。

---

# 如果重新看几个场景，我会这样判断当前完成度

### 熟悉环境日常移动：**架构方向基本对，但太浪费**

Quiet 能做到不乱说，这是很好的。

真正缺的是：

> known scene / familiar scene memory

让它连模型都少调用。

---

### 用户主动问一个视觉问题：**已经比较接近可用**

例如：

> “这个是什么？”

Task + deep、用户主动请求不要求 `changed`、有证据才回答，这套逻辑是合理的。

主要短板是：

> 选图不够好 + 13秒延迟 + 失败时沉默。

---

### 找物：**已经有外框，但内部控制循环还没形成**

这是目前最值得继续做的。

你已经有：

> Task  
> 自动观察  
> memory  
> changed  
> duplicate suppression

只差把它变成：

> 搜索 → 候选 → 确认 → 引导 → 完成

而不是反复：

> “当前帧里有没有目标相关事实？”

Object-recognition 技术在真实 BLV 用户中的研究也发现，**杂乱空间、小物体、定位和识别错误后的恢复**都是实际问题；仅仅输出类别远远不够。[India et al., 2025](https://dl.acm.org/doi/abs/10.1145/3706598.3713107)；ObjectFinder 近期也把开放词汇找物做成持续交互问题，而非单帧识别。[Liu et al., 2026](https://www.tandfonline.com/doi/abs/10.1080/10447318.2026.2695932)

---

### “帮我盯着某件事”：**目前几乎空缺**

这是我认为最应该补的一块。

它天然适合智能眼镜，而且不需要3D。

也特别符合你的：

> **大多数时间应该沉默。**

模型最大的价值不是不停说，而是：

> 一直没人需要说话 → 某个指定事件发生 → 只说一次。

---

### 陌生环境获得概况：**模式概念有了，产品入口没有**

Explore 目前主要通过“轻量检测变化”进入，不像真正的：

> “给我看看周围。”

Awareness 又没有真正路由。

所以用户心智模型还没有建立起来。

---

### 安全导航：**当前明确不能承担**

这反而无需纠结。

文档已经明确没有独立高优先级安全检测链。:chatgpt-content-reference{index="8"}

我不会为了让架构“完整”而硬把它塞进 Qwen。

把产品承诺限制为：

> 环境理解、找物、读物、条件监视、视觉问答

而不是：

> 实时避障

第一阶段反而更健康。

---

# 我认为接下来不是“大改架构”，而是改中心

目前大概是：

```text
Camera
↓
Is image different?
↓
VLM
↓
Is fact allowed to speak?
```

下一版应该变成：

```text
                       User Mode / Task / Watch
                              │
Camera → Visual Gate → Memory ┼→ Need new information?
                              │
                              ▼
                            VLM
                              │
                      Candidate observations
                              │
                              ▼
                       User Knowledge State
                              │
                 Is this NEW + USEFUL + FRESH?
                              │
                   ┌──────────┴───────────┐
                   ▼                      ▼
                 SPEAK                  SILENCE
```

也就是说，中心变量从：

> **画面发生变化了吗？**

改成：

> **用户的信息状态需要更新了吗？**

这是我看完整架构后认为最重要的一次转向。

如果按优先级只改五件事，我会依次做：**真正的 Visual Frame Gate（清晰度+相似度）、关键帧视觉记忆、Task 状态机、Watch/Awareness 条件监控、UserInformationGain/已知信息抑制**。安全链暂时独立，不要用现在的慢 VLM 硬做。

做完这五件事以后，你现在已有的 Queue、Working Memory、Attention Policy、run logging 这些基础设施基本都还能保留，不需要推倒重来。:chatgpt-content-reference{index="9"}

### 对这个判断最相关的研究

*Brady, E., Morris, M. R., Zhong, Y., White, S., & Bigham, J. P. (2013). Visual Challenges in the Everyday Lives of Blind People. CHI. [ACM](https://dl.acm.org/doi/abs/10.1145/2470654.2481291)*

*Szpiro, S., Zhao, Y., & Azenkot, S. (2016). Finding a Store, Searching for a Product: A Study of Daily Challenges of Low Vision People. UbiComp. [ACM](https://dl.acm.org/doi/abs/10.1145/2971648.2971723)*

*Zhao, Y., Kupferstein, E., Rojnirun, H., Findlater, L., & Azenkot, S. (2020). The Effectiveness of Visual and Audio Wayfinding Guidance on Smartglasses for People with Low Vision. CHI. [ACM](https://dl.acm.org/doi/abs/10.1145/3313831.3376516)*

*India, G., Robinson, S., Pearson, J., Morrison, C., et al. (2025). Exploring the Experiences of Individuals Who are Blind or Low-Vision Using Object-Recognition Technologies in India. CHI. [ACM](https://dl.acm.org/doi/abs/10.1145/3706598.3713107)*

*Chang, R. C., Natalie, R., Xu, W., Yap, J. Z. F., et al. (2025). Probing the Gaps in ChatGPT's Live Video Chat for Real-World Assistance for People Who Are Blind or Visually Impaired. ASSETS. [ACM](https://dl.acm.org/doi/abs/10.1145/3663547.3746319)*

*Xie, J., Yu, R., Zhang, H., Billah, S. M., Lee, S., et al. (2025). Beyond Visual Perception: Insights from Smartphone Interaction of Visually Impaired Users with Large Multimodal Models. CHI. [ACM](https://dl.acm.org/doi/abs/10.1145/3706598.3714210)*

*Zhao, Y., Wang, S., Geng, Q., Yu, E., & Li, J. (2025). “Less is More”: Reducing Cognitive Load and Task Drift in Real-Time Multimodal Assistive Agents for the Visually Impaired. [arXiv](https://arxiv.org/abs/2511.00945)*

*Liu, R., Zhang, J., Schön, A., Müller, K., Zheng, J., et al. (2026). ObjectFinder: An Open-Vocabulary Assistive System for Interactive Object Search by People Who Are Blind. International Journal of Human–Computer Interaction. [Link](https://www.tandfonline.com/doi/abs/10.1080/10447318.2026.2695932)*

*Bleau, M., Martiniello, N., Gingras-Royer, N., et al. (2026). Exploring the Use of Smartphone Applications During Navigation-Based Tasks for Individuals Who Are Blind or Who Have Low Vision: Future Directions and Priorities. Disability and Rehabilitation: Assistive Technology. [Link](https://www.tandfonline.com/doi/abs/10.1080/17483107.2025.2544942)*

*Puri, P. R., Coutaller, A., Gwade, F., Kabore, S. S., et al. (2025). Perspectives From Canadian People With Visual Impairments in Everyday Environments Outside the Home: Qualitative Insights for Assistive Technology. JMIR Rehabilitation and Assistive Technologies. [Link](https://rehab.jmir.org/2025/1/e73380/)*