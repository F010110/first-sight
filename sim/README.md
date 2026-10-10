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

## 左右视角对照

`sim/render_side_views.py` 在已录制 episode 的相同位姿重新渲染前视角，以及同光心、左右各 90° 的视图。为避免第三方摄像头拍到角色自身模型，使用主摄像头在静态场景中依次切换朝向，核对三次渲染的光心一致；临时渲染朝向不写入运动记录。检查 house 哈希和每帧位置误差，输出独立目录，不改原样本。它不是硬件同步采集。

```powershell
wsl -d Ubuntu --cd /mnt/d/Projects/Projects2026/VLM -- /mnt/d/Projects/Projects2026/EAM/.venv-thor/bin/python sim/render_side_views.py run/sim/episode-20261007T034358026536Z --house /mnt/d/Projects/Projects2026/EAM/data/procthor-connectivity/val-5.json --output run/sim/multiview-val5-clean-20261007 --windows 40
```

输出 `frames/`、`left/`、`right/` 和带 LEFT/FRONT/RIGHT 标签的 `triple/` 三联图。三联图表示同一时刻、同一局部位置，而非三次访问。模拟是理想同光心多方向视图，不是有镜头间距的真实三摄系统。

```powershell
node dist/sim/replay-eval.js run/sim/multiview-val5-clean-20261007 --mode vlm --motion none --views front --limit 40 --out run/sim/multiview-val5-clean-20261007/eval-front.json
node dist/sim/replay-eval.js run/sim/multiview-val5-clean-20261007 --mode vlm --motion none --views triple --limit 40 --out run/sim/multiview-val5-clean-20261007/eval-triple.json
```

两组都用重新渲染的前视图做 cheap-CV 打分，三视图仅改变 VLM 可见的证据（当前与历史图像）。不把房间标签、位姿交给 Agent。报告保留逐窗判断、修订及仅供评测的位姿配对诊断；1.5m 分离配对只是诊断，不是地点定义或真值。单次回放存在模型随机性、图像布局/分辨率和候选历史差异，不能据此断言多摄一定有效。

上段描述首次历史对照。当前实现已修复：`--views triple` 的 cheap-CV 也使用左右视图，并允许跨方向匹配；新结果不能与旧对照视为只有 VLM 输入变化。运动对照需在当前相同代码下分别使用 `--motion none/perfect/noisy`，以分离算法修复和运动信息的效果。

### 首次对照结果

同一来源的前 40 窗，两组均不提供运动信息，各 40 次身份 VLM 调用。修订前，同位置（窗口终点差 <=0.05m）、不同朝向（差 >=60°）的 19 对窗口中，单前视角 10 对复用同一 Place，三视角 15 对。窗口包含一段运动，因此这是终点位姿诊断，不是严格局部地点真值。

两组最终都只有 2 个 Place、没有 Space，房间纯度均为 0.475（房间指标不等于 Place 识别正确率）。修订前地点切换分别为 12 和 31 次，三视角出现明显两地点交替误绑及锚点幻觉，不能把切换多解释成区分能力提高。单前视角的一次历史重绑定使修订后同位置复用变成 5/19；三视角没有应用修订，仍为 15/19。对照方向一致性时优先比较修订前数据。

初步结论：侧视图增加了可观察内容，并改善这一轮的方向一致性，但没有解决局部地点辨识/记忆污染。需重复实验和更准确的位置关系核验，不能据此直接决定真机硬件。

原始首轮第三方摄像头产物 `multiview-val5-20261007` 有角色自遮挡伪影，不用于上述比较；有效数据在 `multiview-val5-clean-20261007`。

### 人工视频检查

```powershell
python sim/export_view_videos.py run/sim/multiview-val5-clean-20261007
python -m http.server 8878 --bind 127.0.0.1 --directory run/sim/multiview-val5-clean-20261007/viewer
```

打开 `http://127.0.0.1:8878/`。导出 H.264 `left.mp4`、`front.mp4`、`right.mp4`、`triple.mp4`；121 帧按 2 动作/秒播放，约 60.5 秒。离线 HTML 提供同步播放、逐帧、倍速、窗口跳转和原始 Place 判断，以及人工专用 GT 坐标/房间。视频速度是人为设定的离散动作展示速度，不是模拟用户的真实步速。依赖 Python 环境中的 `imageio_ffmpeg`。

第 57 帧感知隔离诊断：`node dist/sim/inspect-view.js <triple/0057.jpg> <output.json>`。不带任何记忆或 GT 时，模型正确描述了左侧马桶、前方蓝墙、右侧洗手盆和垃圾桶。原带记忆回放对应第 19 窗却选择带厨房岛锚点的 scene-1。表明可见内容能被识别，错误至少涉及历史身份/锚点错绑，并非只是侧视图没有信息。诊断的相对位置/米数估计仍未经验证。

代码层面另有风险：高置信度复用会更新 Place 文本/锚点，但代表图通常保留最早五张；错误关联后文本与图像可能脱节。SDK 将整段提示文本放在所有图片之前，当前/历史图片的角色没有逐图交错标签，这可能引起历史图片被误当当前的混淆，尚未用对照实验证实。错误身份还会增加路线计数，不能把高置信度切换视为真实路线学习。

### 动作审计与平滑展示

`python sim/audit_episode.py run/sim/episode-20261007T034358026536Z` 检查每步位置、方向和动作成功标记。前 121 帧包含 97 次 MoveAhead、23 次转向和初始化，零失败；成功移动均为沿当前朝向 0.25m，转向为 90°，无异常跳点。但完整 418 帧有 **119 次动作失败**，不能视为三次成功往返。旧采集器错误地假设回程朝向与初始朝向相差 180°；已改为计算实际终止朝向并在失败时停止，修复尚未重新采集验证。

这些记录是动作终点，不是连续物理运动视频。用于评测的三视角图也是终点位姿重渲染。`--substeps 6` 可以在每个动作之间插入六个相机位姿并重新渲染；这是人工观察用的路径插值，不是记录到的机器人运动，不送给 Agent。

```powershell
wsl -d Ubuntu --cd /mnt/d/Projects/Projects2026/VLM -- /mnt/d/Projects/Projects2026/EAM/.venv-thor/bin/python sim/render_side_views.py run/sim/episode-20261007T034358026536Z --house /mnt/d/Projects/Projects2026/EAM/data/procthor-connectivity/val-5.json --output run/sim/multiview-val5-smooth-20261007 --windows 40 --substeps 6
python sim/export_view_videos.py run/sim/multiview-val5-smooth-20261007 --fps 12 --decisions-from run/sim/multiview-val5-clean-20261007
```

原第 19 窗输入是第 55–57 帧，不只是第 57 帧。第 55 帧确能透过门看到床，但三帧都不支持“当前位于厨房岛左侧”。VLM 原文把浴室物件与历史厨房锚点拼接，并以 confidence=0.85 复用 scene-1。

- `sim/navigation.py` 改编自 `../EAM/src/eam/navigation.py`。
- 房间归属用 floorPolygon 射线法（同 EAM `record_visual_episode.py`）。
- 我们只保留“帧 + GT”这一最小格式；EAM 的 SQLite/内容寻址记忆与 depth 不搬（FirstSight 自己有 Place Memory）。
