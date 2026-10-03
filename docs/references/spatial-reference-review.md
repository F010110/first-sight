# 物理空间定位方案参考

调研日期：2026-09-27。目标是让第一视角助手回答“物体在场景/用户附近的什么位置”，并能在视角改变后继续找到它。这里区分图片中的方位、相机坐标中的米制位置、以及相机移动后的局部场景坐标。

## 结论

物理位置需要几何输入与语义输入协作：相机内参、深度和相机位姿给出可计算的 3D 坐标；检测/分割与跟踪把图像区域对应到物体实例；VLM 负责理解用户说的目标、关系和意图，再查询空间记忆并组织提示。VLM 单看 RGB 截图无法可靠恢复尺度、相机运动或持久的世界坐标。

推荐先以 Android ARCore 建立“RGB 截图 + 同时刻深度 + 同时刻相机位姿”的离线/回放实验路径。现有截图评测可以保留：Qwen 收到的仍然是抽样静帧，深度与位姿作为实验元数据单独记录。ARCore 的相机追踪在设备端持续运行，以便给抽样帧关联正确的传感器状态。

## 本地优先：结合当前手机网页的做法

当前网页通过 `getUserMedia()` 取 RGB 视频，再从视频画布抓图；它还没有读取 ARCore 深度或位姿。给 Qwen 发图走 API 不影响本地几何处理：ARCore 负责手机端跟踪和深度，CPU 就能完成像素反投影、坐标变换、ROI 深度统计和 JSONL 记录，首轮不需要租 GPU。

建议按这个顺序验证：

1. 现有体验页旁已加入 `/spatial-probe`，检查 `immersive-ar`、WebXR `depth-sensing` 和相机位姿，并导出本地诊断 JSON。WebXR 深度模块仍是 W3C Working Draft；需要沉浸式 AR session，特性是否可用由浏览器和设备决定。[WebXR Depth Sensing](https://www.w3.org/TR/webxr-depth-sensing-1/)
2. 如果能力探针能给出可靠且配对的 RGB、深度、位姿，继续用现有二维码网页体验；如果取不到配对数据，就做一个功能很窄的 Android ARCore 采集器，只记录这些传感器数据，再交给现有本机 harness 和 Qwen API。Google 官方 ARCore 文档展示了从同一 `Frame` 取得 16-bit 深度图、相机内参和位姿；支持的设备以及深度可用性需逐台检查。[Depth API guide](https://developers.google.com/ar/develop/java/depth/developer-guide)
3. 探针当前只验证位姿和深度，不验证 RGB 同步，也不保存截图。下一步先让用户在原相机页拍照，再人工点选目标，取对应 ROI 内稳定的深度中位数，输出当前相机坐标中的距离/方向；再把局部点变换到场景坐标，验证用户移动相机后坐标保持一致。此步骤不依赖任何识图模型或 GPU。
4. 几何正确后，再把 Qwen 的场景识别/目标描述和 ROI 对上。首轮可人工点选物体区域，避免把 VLM 粗略框选误差混同为空间坐标错误。之后再评估 API 视觉定位是否足够稳定，或是否需要专门分割模型。

只有在自动检测、分割或对象重识别成为瓶颈时，才测本机 CPU 与 API 延迟并考虑云 GPU。把帧传到云端并不会自动生成可靠的局部坐标；相机位姿和深度仍应在设备端采集并随帧传递。

## 方案对比

| 方案 | 能解决什么 | 对本项目的用途与限制 |
|---|---|---|
| [ARCore Depth API](https://developers.google.com/ar/develop/depth) + [Camera Pose](https://developers.google.com/ar/reference/java/com/google/ar/core/Camera) | Android 设备提供深度图、相机内参和局部世界坐标中的相机位姿。深度可由手机运动估算，部分设备还会融合 ToF。 | 最适合作为 Android 物理定位的第一步。设备支持情况不同；深度模式默认关闭；运动不足、弱纹理表面等情况会降低质量。位置只在 ARCore tracking 有效时使用。它提供几何，不负责认出“用户要找的杯子”。 |
| [Embodied VideoAgent](https://github.com/Embodied-VideoAgent/embodied-videoagent) / [论文](https://openaccess.thecvf.com/content/ICCV2025/html/Fan_Embodied_VideoAgent_Persistent_Memory_from_Egocentric_Videos_and_Embodied_Sensors_ICCV2025_paper.html) | 将稀疏第一视角帧、深度和 6D 相机位姿变成时间记忆与持久 3D 物体记忆；以物体检测、2D→3D lifting、物体重识别和可调用工具支持空间查询。 | 与“物体离开视野后仍记得位置”最接近。代码提供自定义帧接口：RGB、depth、depth mask、camera translation/rotation、FOV。官方 README 写明测试环境为 Ubuntu + RTX 4090，并使用 Habitat-Sim；其检测、分割、CLIP/DINOv2 也比较重。浅克隆里没有发现 LICENSE，因此只作架构和接口参考，不拷贝代码。 |
| [IT3DEgo](https://github.com/it3dego/it3dego) / [论文](https://openaccess.thecvf.com/content/CVPR2024/papers/Zhao_Instance_Tracking_in_3D_Scenes_from_Egocentric_Videos_CVPR_2024_paper.pdf) | 给定 RGB-D、逐帧相机位姿和物体实例，逐时刻输出物体在该视频序列局部世界坐标中的 3D 中心。数据来自 HoloLens 2，含 RGB、深度、多路灰度相机、标定和物体位置标注。 | 非常适合作为空间记忆评测参照，也展示了多相机必须提供标定和相机间变换。数据集约 900GB，不建议首轮下载。公开 demo 需要 SAM、DINOv2 等。代码是 MIT；本地只读副本在 `reference-code/it3dego/`。 |
| [ConceptGraphs](https://github.com/concept-graphs/concept-graphs) | 将带位姿的 RGB-D 帧融合成开放词汇物体地图/场景图，记录物体和关系并支持自然语言查图。相关示例把 RGB-D 数据送到电脑构图。 | 适合参考“物体中心的 3D 地图”和语义关系表达。示例需要在 Linux/桌面端运行 CUDA/PyTorch、SAM 等模型；官方主仓库 MIT。可用于后续离线回放或桌面可视化。 |
| [VLMaps](https://github.com/vlmaps/vlmaps) | 把视觉语言特征锚定到 3D 地图，让自然语言地标和空间目标落到地图坐标。 | 可借鉴语义查询和地标关系；面向机器人导航研究，依赖已建地图，不是 Android 端现成组件。 |
| [EgoLoc](https://github.com/wayne-mai/egoloc) / [论文](https://openaccess.thecvf.com/content/ICCV2023/papers/Mai_EgoLoc_Revisiting_3D_Object_Localization_from_Egocentric_Videos_with_Visual_ICCV_2023_paper.pdf) | 通过视频中的视觉目标和相机定位，估计物体相对查询帧的 3D 位移。 | 可参考“只在某一帧看到物体，转身后要回到它附近”的研究问题；依赖摄像机重定位、场景扫描和离线视觉几何，不是轻量手机闭环。 |
| [DUSt3R](https://github.com/naver/dust3r) | 从多张图片估计稠密 3D 点图并对齐场景，可用于没有标定的离线图像重建。 | 可做离线几何对照实验，不适合作为持续移动中的手机定位层。代码为 CC BY-NC-SA 4.0，非商业许可。 |
| [FoundationPose](https://github.com/NVlabs/FoundationPose) | 对有 CAD 模型或少量参考图的特定新物体估计/跟踪 6D 物体姿态。 | 适合“已指定的某个对象姿态”或机器人抓取；对开放词汇的房间级物体定位过重。NVIDIA 源码许可限制为非商业研究/评估用途。 |
| [NaviSense](https://arxiv.org/abs/2509.18672) 与 [ObjectFinder](https://arxiv.org/abs/2412.03118) | 两项视障辅助系统研究分别组合 VLM、AR/LiDAR、语音/触觉反馈，或开放词汇检测器与 MLLM，并向用户提供目标方向/距离及交互式找物流程。 | 适合参考提示节奏、目标确认和用户交互。NaviSense 论文报告 12 名参与者的评估，ObjectFinder 报告 8 名参与者；本次检索没有在论文页找到公开代码链接。 |
| [Vinci](https://github.com/OpenGVLab/vinci) | 实时第一视角视频流、按时间抽取多帧、将过去画面压成带时间戳的文本记忆。 | 适合作为连续观察与历史摘要参考，不包含深度、相机位姿或 3D 地图。已有检查记录见 [vinci-review.md](vinci-review.md)。 |

## 建议的数据与实现路径

1. **先独立验证几何。** 手机拍照时同步保存 RGB、ARCore 深度、camera intrinsics、camera pose、timestamp 和 tracking state。先手工点选/框选一个已知物体，用深度和位姿计算 3D 点；这可以把坐标变换问题与 VLM 识别问题分开定位。
2. **再接入视觉目标。** 对截图产生检测框或实例 mask；在框/mask 内筛掉无效深度和前景/背景离群点，得到物体 3D 区域或中心。评测截图仍可稀疏抽样，几何元数据必须与原帧时间戳对齐。
3. **建局部持久记忆。** 每个物体实例至少存 `类别/描述、局部 XYZ、置信度、最后观测时间、最近一次图像区域、是否可能移动`。转向后，用当前相机位姿把地图中的 XYZ 换算成当前相机方向和距离；目标被遮挡或过期时降低置信度，避免把旧位置说成当前事实。
4. **最后交给 Qwen 解释意图。** Qwen 将“找蓝盖子”映射到候选物体/关系，并用几何模块给出的方向、距离和新鲜度组织提示。`左边`应区分“当前截图左边”和“场景坐标中、转身后仍在原处”。
5. **按结果决定是否上多摄像头。** 单手机的深度+位姿已能验证一条物体 3D 定位链路。多相机可拓宽视野并缓解遮挡，但需要时间同步、每台相机内参、相机间外参、共同坐标系和跨视角实例匹配。IT3DEgo 的 HoloLens 数据可以作为这类标定/融合的参照。先测出单摄像头在哪些场景失败，再定硬件。

## 需要明确的边界

- ARCore 的“世界坐标”是一次追踪会话内的局部坐标，长时间运行可能漂移；跨天、跨房间重新打开后要考虑重定位或重新建图。
- 深度相机值与 RGB 截图需做正确的对齐和标定。IT3DEgo 的 `proj_utils.py` 明确演示了把独立深度相机的点投影到 RGB 相机；手机方案如果深度图已与 RGB 对齐，仍要核实分辨率、裁剪和旋转。
- 相机坐标不天然等于人体坐标。手持手机的镜头朝向可能偏离用户身体朝向；初期提示应明确以“当前相机方向”为参照，若要说“你的右前方”，需规定手机握持/佩戴方式或估计身体朝向。
- 物体会被拿走。需要区分“最后一次在某处看到”与“确定它现在还在那里”，结合连续检测和用户交互更新物体状态。

## 本地参考代码

- `reference-code/vinci/`：视频流与文本历史参考；没有发现许可文件。
- `reference-code/it3dego/`：MIT 许可的研究 demo 与投影/标定示例；未下载其大型数据集，未安装依赖或运行。
- `reference-code/embodied-videoagent/`：持久 3D 物体记忆实现参考；未发现许可文件，未安装依赖或运行。

这些目录被 `.gitignore` 忽略，保留作本地只读检查。当前没有把参考项目代码并入产品。
