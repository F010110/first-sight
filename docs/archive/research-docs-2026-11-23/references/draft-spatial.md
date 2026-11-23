我会重新定义它：**不是具身智能系统，也不是“VLM 每隔几秒描述一次画面”，而是一个持续观察、选择性发言的视觉语言代理。**

它唯一的外部 action 确实是语言，但这已经足够形成闭环：

> 观察世界 → 判断用户当前需要知道什么 → 说一句话 → 用户据此行动 → 摄像头看到新的世界 → 再决定要不要说。

因此，具身智能里很多关于“闭环、异步、状态、策略”的思想仍然适用；但**我不建议为了这个原因把 VLM 换成传统意义上的 VLA/具身模型。** 对你们更匹配的下一代模型其实是 **streaming / egocentric VLM**。

### 我会把产品从“VLM 问答”改成四层

现在大概是：

```text
每秒截图
   ↓
攒 4 张
   ↓
VLM
   ↓
说出回答
```

我会变成：

```text
                持续视频
                   │
          ┌────────┴────────┐
          ▼                 ▼
    快速视觉状态          最近视觉记忆
 motion / blur /       objects / text /
 scene change /        previous events
 tracking                  │
          └────────┬────────┘
                   ▼
             Semantic Model
          “现在发生了什么？”
                   │
                   ▼
             Speaking Policy
        “这件事现在值得说吗？”
                   │
          ┌────────┼─────────┐
          ▼        ▼         ▼
         说       等待       不说
```

这里最重要的改变，是把：

> **VLM 输出 = 用户听到的话**

改成：

> **VLM 输出 = 系统对当前世界的一次理解**

然后再由一个 **speaking policy** 决定是否告诉用户。

这其实比是否采用“具身模型”重要得多。

---

## 为什么我不建议现在直接换 VLA / 具身模型

传统 VLA 的核心输出类似：

```text
move arm
turn left
grasp
joint velocity
```

而你们所有动作都是：

```text
SAY(...)
SILENCE
WAIT
RECHECK
```

所以它真正的 action space 极其小。

你并不需要让一个大模型学习机器人动力学，也不需要 RT-2、OpenVLA 这种模型所学习的大量 robot trajectory。

你们真正需要模型特别强的反而是五件事：

**第一，第一视角连续视频理解。**

不是“四张图片分别有什么”，而是：

> 用户刚才转头了吗？  
> 那把椅子是刚出现还是一直在那里？  
> 刚才看到的门现在去了哪里？

这正是 **egocentric / streaming vision-language** 研究关注的问题。例如 Vinci 和 ActiveEye 就在研究便携设备上如何持续处理第一人称视频，而不是重复独立处理静态帧。  
[Huang et al., 2025](https://dl.acm.org/doi/abs/10.1145/3749513)；[Xu et al., 2025](https://dl.acm.org/doi/abs/10.1145/3770641)

**第二，时间记忆。**

系统需要知道：

> “这个我已经告诉过用户了。”

否则就会出现：

> “前面有桌子。”  
> 15 秒后：“前面有桌子。”  
> 再过 15 秒：“前面有桌子。”

这不是 perception failure，而是 **agent state failure**。

**第三，任务相关性。**

用户正在“找咖啡杯”时：

> “墙上挂着一幅画”

虽然是真的，但没有价值。

用户准备坐下时：

> “椅子就在你右手边”

价值就很高。

**第四，proactive intervention。**

传统 VLM 是：

> 用户问 → 模型答。

你们真正需要：

> 模型不断看 → 大部分时间什么都不说 → 在值得说的时候主动说。

2025 年已经有直接研究 streaming egocentric video 上 **proactive assistant dialogue generation**，这其实比机器人 VLA 更贴近你们。  
[Zhang et al., 2025](https://aclanthology.org/2025.emnlp-main.605/)

**第五，可靠的空间语言。**

不仅要识别：

> chair

而要可靠地产生：

> “椅子在右前方大约两步。”

而且必须知道这个方位是**当前坐标系**还是十几秒以前的坐标系。

这恰恰是现在通用 MLLM 用于 BLV guidance 时仍然容易出问题的地方。近期针对视障用户的 live video 和视觉助手研究都发现，真实环境中的 navigation、空间关系和持续交互比单张图片 VQA 困难得多。  
[Chang et al., 2025](https://dl.acm.org/doi/abs/10.1145/3663547.3746319)；[Karamolegkou et al., 2025](https://aclanthology.org/2025.acl-long.1260/)

---

# 所以我更倾向于：保留 VLM，但改变 VLM 的角色

这是我认为最重要的一点。

现在的设计可能是：

> **VLM 是产品。**

我会把它改成：

> **VLM 是一个 semantic sensor。**

它负责回答：

```text
现在看到了哪些重要东西？
与用户任务有关的是什么？
与上一次相比发生了什么变化？
有哪些东西不能确定？
```

但它不直接决定最终语言。

然后有一个很轻量的 policy：

```text
if 危险且新鲜:
    立刻说
elif 与当前目标直接有关 && 是新信息:
    说
elif 用户刚提问:
    回答
elif 信息已经说过:
    不说
elif observation 太旧:
    不说，重新确认
else:
    silence
```

这个 policy 第一版甚至完全不需要另一个神经网络。

可以就是代码 + 一点 LLM reasoning。

---

# 这样还会出现一个很重要的设计：系统有两种语言

一类是**描述语言**：

> “桌上有一个红色杯子，旁边是一台笔记本电脑。”

另一类是**指导语言**：

> “杯子在你右前方。”

更进一步是：

> “向右扫一点。”

这三者虽然都是语言，但作用完全不同。

我会把它们明确分开：

| 类型 | 例子 | 什么时候使用 |
|---|---|---|
| Awareness | “前方是一个咖啡店柜台。” | 用户了解环境 |
| Goal information | “你要找的杯子在桌子右侧。” | 找物 |
| Guidance | “向右一点。” | 用户正在根据提示调整视角 |
| Warning | “停，前方有台阶。” | 高紧迫性 |
| Confirmation | “对，就是这个按钮。” | 完成动作 |
| Silence | — | 没有新价值的信息 |

于是模型的任务不再只是：

> “生成一句 caption。”

而是：

```text
event = {
  type: guidance,
  importance: 0.8,
  freshness: 0.95,
  novelty: 1,
  confidence: 0.91,
  content: ...
}
```

系统最后才生成一句非常短的话。

---

# 我尤其建议加入一个“语言预算”

这是智能眼镜与普通聊天机器人非常不一样的地方。

语音会占据用户的**听觉通道**。

对于视障用户，环境声音本来就是非常重要的信息源。因此系统不能因为“有东西可说”就不断说话。

可以给系统一个概念：

> **speech budget**

例如普通环境下：

- 没有重要变化，不说；
- 同一信息不重复；
- 普通提示最多一句；
- 用户正在移动时比静止时更加简短；
- 一旦发现高优先级事件，可以打断低优先级描述。

因此整个优化目标不应该是：

> 每分钟给用户最多的信息。

而应该更像：

\[
\text{utility}
=
\frac{\text{有用且及时的信息}}
{\text{语言占用 + 错误提示 + 重复提示}}
\]

近期关于 BLV 实时多模态辅助的工作甚至直接出现了 **“Less is More”** 这一思路，重点就是减少 cognitive load 和 task drift。  
[Zhao et al., 2025](https://arxiv.org/abs/2511.00945)

---

# 然后重新思考你们现在的“每 15 秒分析一次”

我认为这个设计最终很可能应该取消。

不是：

> 每 15 秒问一次：“有什么？”

而是让系统持续维护几个简单信号：

```text
scene_changed
camera_stable
user_moving
new_object_candidate
target_visible
text_region_visible
possible_hazard
user_asked_question
semantic_state_expiring
```

然后由这些事件决定要不要调用 VLM。

例如用户坐在办公室里 5 分钟不动：

> 根本不需要每 15 秒调用一次 VLM。

用户突然站起来，摄像头剧烈移动：

> 不要马上调用，因为图可能很糊。

相机稳定：

> 调一次。

用户说：

> “我的咖啡在哪？”

立即进入 **target-search mode**。

之后系统的 sampling / prompt / speaking policy 都发生变化。

所以用户意图应该改变 perception policy。

这非常像 active perception，但不需要把它做成一个真正机器人。

---

# 我甚至会把“找物”单独做成一种状态机

例如用户：

> “帮我找钥匙。”

状态：

```text
SEARCHING
```

系统：

> “慢慢向左扫。”

摄像头连续看。

如果没有找到：

> 不必让 VLM连续说没看到。

用户转动。

发现疑似钥匙：

```text
CANDIDATE_FOUND
```

系统：

> “停一下。”

重新获取一张稳定的新图。

确认：

```text
CONFIRMED
```

系统：

> “钥匙在正前方桌面，靠近杯子。”

用户移动。

tracker 持续跟踪。

如果目标从当前画面消失：

> “稍微向右。”

最后：

```text
DONE
```

> “就在你面前。”

注意这里几乎所有 action 都是语言。

但它已经是一个非常明确的 **closed-loop agent**。

这也是 NaviSense、ObjectFinder 等近期 BLV object retrieval 系统真正值得你们借鉴的地方：目标不是让 MLLM 写更漂亮的图像描述，而是帮助用户完成一个持续的视觉任务。  
[Sridhar et al., 2025](https://dl.acm.org/doi/abs/10.1145/3663547.3759726)；[Liu et al., 2026](https://www.tandfonline.com/doi/abs/10.1080/10447318.2026.2695932)

---

# 那未来什么时候值得“换模型”？

我不会用“是不是 embodied model”作为选择标准。

我会用下面六个能力测试：

1. **Streaming video**：能否接受持续视频，而不是独立图片？
2. **Temporal memory**：能否理解“刚才”和“现在”的变化？
3. **Egocentric spatial reasoning**：能否稳定处理左/右/前/后、距离、用户运动？
4. **Proactivity**：能否判断什么时候应该主动介入？
5. **Low latency**：是否真正能在需要的时间尺度响应？
6. **Structured output**：能否先输出状态/事件，而不仅是自然语言？

如果出现一个所谓“embodied model”，这六项都明显好于你们现在的 Qwen，那当然值得换。

但如果一个 VLA 模型的强项是：

> mechanical manipulation / robot action generation

而视频实时性、语言输出、BLV 场景反而没优势，那对你们没有意义。

**名字叫不叫 embodied 不重要。**

---

# 从目前的研究发展看，我会更关注这一类模型

不是：

> **Vision-Language-Action Model**

而是：

> **Streaming Egocentric Vision-Language Model**

这和你们的产品形态几乎完全一致：

```text
第一人称摄像头
+
连续时间
+
用户上下文
+
自然语言反馈
```

Vinci 明确面向 portable device 上的 egocentric real-time assistant；ActiveEye 研究 smart eyewear 上 continuous、responsive video understanding；EgoLife 则进一步研究面向智能眼镜的第一人称生活助手。这一条技术路线与“视障智能眼镜”比传统机器人 VLA 更直接。  
[Huang et al., 2025](https://dl.acm.org/doi/abs/10.1145/3749513)；[Xu et al., 2025](https://dl.acm.org/doi/abs/10.1145/3770641)；[Yang et al., 2025](https://ieeexplore.ieee.org/abstract/document/11095171/)

---

## 如果让我现在重新设计 MVP

我不会先训练新模型。

我会保留现在的 Qwen VLM，先把产品结构改掉：

```text
Camera stream
      │
      ├────────────→ Ring buffer
      │
      ▼
轻量实时视觉 / IMU
motion / stability / scene-change
      │
      ▼
 Task State
找物 / 阅读 / 环境了解 / 用户提问
      │
      ▼
 Trigger
“现在值得调用 VLM 吗？”
      │
      ▼
 VLM semantic observation
结构化输出，不直接面向用户
      │
      ▼
 Temporal World State
什么看见过 / 多久以前 / 是否还有效
      │
      ▼
 Speaking Policy
重要？新鲜？新信息？确定？
      │
 ┌────┴─────┐
 ▼          ▼
SPEAK      SILENCE
```

然后拿真实视障用户任务测。

如果这个架构已经明显改善体验，那么你们就知道：

> 瓶颈不是“模型不够 embodied”，而是原来的产品没有把模型放在正确的位置。

如果进一步发现主要问题变成：

> Qwen 无法理解连续变化、经常搞错相机移动后的空间关系、无法利用长时间第一视角上下文，

那时再换 **egocentric streaming model**，理由就非常充分。

所以我的结论会非常明确：

> **目前不用为了“具身智能”去换 VLM。先把系统从“周期性 VLM captioner”改成“event-driven、stateful、selective-speaking visual agent”。**
>
> **未来如果换模型，首选方向不是机器人 VLA，而是低延迟、连续视频、第一视角、具有时序记忆的 streaming egocentric VLM。**

这更符合你们只有“语言”这一种输出动作的产品本质。

### 相关研究

*Huang, Y., Xu, J., Pei, B., Yang, L., Zhang, M., et al. (2025). Vinci: A Real-Time Smart Assistant Based on Egocentric Vision-Language Model for Portable Devices. Proceedings of the ACM on Interactive, Mobile, Wearable and Ubiquitous Technologies. [ACM](https://dl.acm.org/doi/abs/10.1145/3749513)*

*Xu, Z., Lu, T., Zhao, Y., Wang, Y., Dong, M., et al. (2025). ActiveEye: Enabling Continuous and Responsive Video Understanding for Smart Eyewear Systems. Proceedings of the ACM on Interactive, Mobile, Wearable and Ubiquitous Technologies. [ACM](https://dl.acm.org/doi/abs/10.1145/3770641)*

*Yang, J., Liu, S., Guo, H., Dong, Y., Zhang, X., et al. (2025). EgoLife: Towards Egocentric Life Assistant. IEEE/CVF Conference on Computer Vision and Pattern Recognition. [IEEE](https://ieeexplore.ieee.org/abstract/document/11095171/)*

*Zhang, Y., Dong, X. L., Lin, Z., Madotto, A., et al. (2025). Proactive Assistant Dialogue Generation from Streaming Egocentric Videos. Proceedings of EMNLP 2025. [ACL](https://aclanthology.org/2025.emnlp-main.605/)*

*Sridhar, A. N., Qiao, F., Troncoso Aldas, N. D., Shi, Y., et al. (2025). NaviSense: A Multimodal Assistive Mobile Application for Object Retrieval by Persons with Visual Impairment. ASSETS 2025. [ACM](https://dl.acm.org/doi/abs/10.1145/3663547.3759726)*

*Chang, R. C., Natalie, R., Xu, W., Yap, J. Z. F., et al. (2025). Probing the Gaps in ChatGPT's Live Video Chat for Real-World Assistance for People Who Are Blind or Visually Impaired. ASSETS 2025. [ACM](https://dl.acm.org/doi/abs/10.1145/3663547.3746319)*

*Karamolegkou, A., Nikandrou, M., et al. (2025). Evaluating Multimodal Language Models as Visual Assistants for Visually Impaired Users. ACL 2025. [ACL Anthology](https://aclanthology.org/2025.acl-long.1260/)*

*Xie, J., Yu, R., Zhang, H., Billah, S. M., Lee, S., et al. (2025). Beyond Visual Perception: Insights from Smartphone Interaction of Visually Impaired Users with Large Multimodal Models. CHI 2025. [ACM](https://dl.acm.org/doi/abs/10.1145/3706598.3714210)*

*Hao, Y., Yang, F., Huang, H., Yuan, S., Rangan, S., et al. (2024). A Multi-Modal Foundation Model to Assist People with Blindness and Low Vision in Environmental Interaction. Journal of Imaging, 10(5), 103. [Link](https://www.mdpi.com/2313-433X/10/5/103)*

*Zhao, Y., Wang, S., Geng, Q., Yu, E., & Li, J. (2025). “Less is More”: Reducing Cognitive Load and Task Drift in Real-Time Multimodal Assistive Agents for the Visually Impaired. [arXiv](https://arxiv.org/abs/2511.00945)*