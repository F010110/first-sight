# 模拟器采集（FirstSight Sim）

用 AI2-THOR / ProcTHOR 生成**带真值**的室内巡检 episode，用于自动测试三个阶段 agent（场景/场景变化/用户要求），替代人工走位验证。

## 数据格式

每个 episode 写入 `run/sim/<episode-id>/`（`run/` 已被 git 忽略）：

```
frames/0000.jpg ...        按时间顺序的 RGB 观察
observations.jsonl         每帧：{tick, action, room(GT), success, x, y, z, yaw, horizon}
manifest.json              户型、房间、路线、是否截断、house sha256
```

`room` 是**评测用真值**，绝不能给被测 agent。位姿来自模拟器（oracle），也只用于评测/导航，不作为 agent 输入。

## 运动模式（不含位移）

agent 只吃**定性运动模式**，不拿任何位移/坐标。用后处理从 episode 派生（不必重跑模拟器）：

```powershell
python sim\derive_motion.py run\sim\<episode> --observe-every 3
```

写出 `windows.jsonl`，每个 agent 观察窗口一行：

```
{ window, startTick, endTick, frame, room(GT), startPose, endPose,
  motionPerfect,   # 由 GT 动作派生的干净描述
  motionNoisy }    # 模拟真机失败模式（丢段 / 转向读成横移 / 角度缩放）
```

replay 端选择三种模式之一喂给 agent，**位姿只用于评测**：

| 模式 | agent 收到 |
|---|---|
| `none` | 不带运动信息（下界） |
| `perfect` | `motionPerfect` |
| `noisy` | `motionNoisy`（鲁棒性对照） |

不合成完整 IMU 数据：agent 从不需要位移，端上 VIO 的失败模式已用 `noisy` 近似。

## 运行（WSL + AI2-THOR）

复用 EAM 的模拟器环境（WSL Ubuntu + `.venv-thor`，AI2-THOR 5.0.0）：

```powershell
# 完整往返路线（会重访房间），约 138 帧
wsl -d Ubuntu --cd /mnt/d/Projects/Projects2026/VLM -- `
  /mnt/d/Projects/Projects2026/EAM/.venv-thor/bin/python sim/record_episode.py `
  --house /mnt/d/Projects/Projects2026/EAM/data/procthor-connectivity/val-5.json `
  --fixed-route --max-frames 300

# 也可用其它自带户型
#   ...val-3.json （5 房间）  ...val-4.json （4 房间）
```

`--fixed-route` 使用 `sim/navigation.py`：在可达网格上 BFS 到最远点、沿路返回，因此会**两次经过同一房间**，正好用来测 place recognition 与 visit。

## 与 EAM 的关系

- `sim/navigation.py` 改编自 `../EAM/src/eam/navigation.py`。
- 房间归属用 floorPolygon 射线法（同 EAM `record_visual_episode.py`）。
- 我们只保留“帧 + GT”这一最小格式；EAM 的 SQLite/内容寻址记忆与 depth 不搬（FirstSight 自己有 Place Memory）。
