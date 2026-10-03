## V1 实验架构

核心问题只有一个：

> **能否通过廉价的启发式视觉 Router，在大幅减少强 VLM 调用的情况下，完成日常第一视角视觉辅助任务？**

整体 pipeline：

```text
                         ┌──── 最近 10s Ring Buffer ────┐
                         │                              │
Camera 30 FPS            │                              │
     ↓                   │                              │
定期采样 1~2 FPS ──→ Heuristic Router                  │
                         │                              │
              ┌──────────┼──────────┐                   │
              ↓          ↓          ↓                   │
             SKIP     Weak VLM   Strong VLM ←──────────┘
                         │          │
                         └────┬─────┘
                              ↓
                      Structured Observation
                              ↓
                         Agent State
                              ↓
                         Agent Rules
                         ↙          ↘
                     SILENT          TTS
```

### 1. 输入层

摄像头正常录制，例如 **30 FPS**，但模型完全不需要处理 30 FPS。

维护两个东西：

* **Router frame**：例如每 0.5–1 秒抽一帧；
* **Ring buffer**：保存最近约 10 秒原始画面/关键帧。

后者非常重要。Router 在 \(t\) 时刻发现“好像发生事情了”，Strong VLM 可以拿到 `t-3, t-2, t-1, t`，而不只是最后一张照片。

---

### 2. Heuristic Router

V1 不训练。

只计算便宜特征：

$$
x_t =
(\text{pixel change},
\text{embedding change},
\text{motion},
\Delta t,
\text{user query})
$$

然后手写规则。

例如：

```python
if user_query:
    STRONG

elif semantic_change > HIGH:
    STRONG

elif semantic_change > MID:
    WEAK

elif time_since_last_check > 10s:
    WEAK

else:
    SKIP
```

第一版甚至可以先不加 optical flow/OCR/object detector。**能少一个模块就少一个模块。**

---

### 3. Weak / Strong VLM

两者接受完全相同的 prompt/schema，只是能力和价格不同。

例如 Weak 用廉价视觉模型，Strong 用 Astra。

要求输出：

```json
{
  "scene": "university corridor",
  "changes": [
    {
      "type": "text",
      "content": "Room 301",
      "position": "right"
    }
  ],
  "relevant_to_goal": true,
  "importance": 0.72,
  "uncertainty": 0.18
}
```

这里有一个很重要的 escalation：

```text
Router → Weak
          ↓
     uncertainty high
          ↓
        Strong
```

所以 Router 不需要一次就做对所有事情。

---

### 4. Agent State

不要一开始做复杂 Memory System。

维护一个简单 JSON 就够：

```json
{
  "goal": "find Room 301",
  "current_scene": "corridor",
  "recent_events": [],
  "recent_speech": [],
  "last_strong_call": 12.4
}
```

VLM 每次 observation 更新它。

这样系统至少知道：

> 用户正在干什么；

> 刚才发生了什么；

> 什么已经告诉过用户。

否则眼镜很容易每隔五秒说一次：

> “你正在走廊里。”

---

### 5. Speech Policy

V1 同样先写规则。

例如：

$$
Speak =
Relevant
\land
Novel
\land
\neg RecentlySpoken
$$

再加用户主动询问直接回答。

所以系统看到：

> “右边是 301。”

如果用户目标是找 301：

→ **“301 在你右边。”**

如果用户没有这个目标：

→ **保持沉默。**

这正好验证“视觉助手”与“实时图像 captioner”的区别。

---

## 第一版任务集

我建议不要做泛化的“陪我生活一天”，否则根本没法评测。先设计大约 **4 类任务**：

| Task | 示例              |   允许延迟 |
| ---- | --------------- | -----: |
| 寻找   | “帮我找 301 教室”    |  2–5 s |
| 读取   | “看到通知/门牌时告诉我”   |  2–5 s |
| 环境提醒 | “看到空座位告诉我”      | 3–10 s |
| 回顾   | “刚才经过的那个房间是多少？” |    5+s |

找东西尤其适合 Demo：

> “帮我找一下我的水杯。”

用户正常走动，系统大多数时候沉默；发现疑似目标 → Weak VLM；需要确认 → Strong VLM；确认后：

> **“水杯在右前方桌面上。”**

整个 pipeline 都展示出来了。

---

## 最关键的实验对照

第一版不要急着证明算法创新，先回答**这个架构有没有意义**。

设置三个系统：

**A. Strong-1FPS**

> 每秒 Strong VLM。

近似暴力能力上界。

**B. Weak-1FPS**

> 每秒 Weak VLM。

廉价 baseline。

**C. Router**

> Heuristic Router → SKIP / Weak / Strong。

然后测：

$$
\text{Task Success Rate}
$$

$$
\text{Useful Information Recall}
$$

$$
\text{Unnecessary Speech / min}
$$

$$
\text{Strong Calls / min}
$$

$$
\text{Cost / hour}
$$

$$
\text{Response Latency}
$$

最终最希望看到的是类似：

```text
                 Success    Strong calls    Cost
Strong-1FPS       95%          60/min       100%
Weak-1FPS         78%           0/min         8%
Router            91%           5/min        15%
```

数字当然是假设的，但**这就是你们第一版应该追求的结果形态**。

如果 Router 真的出现这种 Pareto improvement，下一阶段才值得问：

> heuristic router 能不能换成一个很小的 learned router？

如果第一版发现 heuristic 根本省不了多少调用，或者 Weak-1FPS 已经什么都能完成，那也很好——你们会在很低的开发成本下知道原来的“routing 创新点”并不成立。

所以现在我认为 **V1 最小实现甚至可以控制在 Camera/Ring Buffer + 图像差异/embedding + 两个 VLM API + JSON Agent + TTS 六个模块**。不要先碰硬件眼镜，电脑 + 手机摄像头就足够把整个假设测出来。
