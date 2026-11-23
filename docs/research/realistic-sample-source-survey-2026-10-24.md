# 更真实的模拟／真实样本：建议11来源核查

核查日期2026-10-24，依据官方项目、下载文档及HF文件API，不把建议原文、搜索摘要或宣传图当已获得的数据。此次只收集来源与小样本，不修改算法，不运行付费模型，不恢复硬件通信实验。

## 结论与优先级

1. **ReplicaCAD Interactive先做可控事件小样本**：可以真实渲染独立三摄、保存精确仿真位姿、显式移动物体／开合抽屉；但这是人工重建公寓，不是现实视频，也不是多种独立建筑。
2. **AEA是下一步真实空间重访首选**：同一地点的MPS轨迹处于共享坐标系，可以辅助独立标注；数据需用户注册取得下载链接，不能从HF介绍页直接下载视频。
3. **EgoLife先用连续视频验证读取，再扩到跨天记忆**：公开可下载的视频与EgoLifeQA都已找到；少量连续片段不能证明长期问答能力，QA所需其他日期证据不得省略。
4. HM3D用于建筑多样性，HSSD用于多场景／家具交互；Ego4D和EmbodiedScan留作补充，不在第一轮引入大量依赖。

## 官方来源核查

|数据|已确认内容|访问／许可与规模|适合与不适合|
|---|---|---|---|
|[ReplicaCAD](https://aihabitat.org/datasets/replica_cad/)|可交互物体、URDF关节、碰撞、navmesh、布局配置；公开84/105布局变体，另有6个原扫描重建场景|[官方HF](https://huggingface.co/datasets/ai-habitat/ReplicaCAD_dataset)，CC BY 4.0，API gated=false；本次清单157,450,746字节，约150.16MiB，非旧资料所写固定140MB|优先生成取放／重访／遮挡事件；不是84座不同房屋，不适合声称多楼层／户外覆盖|
|[AEA下载](https://facebookresearch.github.io/projectaria_tools/docs/open_datasets/aria_everyday_activities_dataset/aea_download_dataset)|143条序列，约353GB；recording.vrs、metadata、speech、MPS闭环／开环轨迹、校准、半稠密点云；按地点共享坐标系|需邮箱注册及AEA许可，下载链接文件14天失效；[HF](https://huggingface.co/datasets/projectaria/aria-everyday-activities)的siblings只有介绍／图片等，没有VRS|真实跨序列重访；MPS是估计轨迹，不自动等同于独立房间／楼层真值，也没有现成生活问答标准答案|
|[EgoLife](https://github.com/EvolvingLMMs-Lab/EgoLife)|HF有6人按DAY分目录的视频，EgoLifeCap、EgoIT和EgoLifeQA；本次列出591,255字节的EgoLifeQA_A1_JAKE.json|[数据HF](https://huggingface.co/datasets/lmms-lab/EgoLife)卡声明MIT；代码仓库另为S-Lab许可，二者不能混称；保留双方原许可，不重新分发视频|适合真实动态、跨天记忆；固定真人轨迹，不是可控三摄仿真；视频公开不证明原始IMU／6DoF全部发布|
|[HM3D](https://github.com/matterport/habitat-matterport-3dresearch)|1000个真实建筑扫描；v0.2 minival GLB约464M、Habitat资产390M、语义240.6M；公开example也分几何与语义文件|学术、非商业许可；完整下载／API需Matterport访问凭据；本次未注册、未取token|提供跨建筑几何与视觉多样性；几何文件不自带完整房间真值；静态扫描不含连续生活状态变化|
|[HSSD](https://huggingface.co/datasets/hssd/hssd-hab)|211场景／18000+模型；新版v0.3.0介绍202可关节化场景，其中161公开，并有区域体积标注与receptacle|CC BY-NC 4.0；本次API gated=false，但卡仍含许可确认提示；不能仅凭旧提示说当前一定登录受限；当前API usedStorage约15.6GB，不等于单场景最小依赖大小|适合多房屋与开合／物体状态实验，后续先做单场景依赖闭包；不要假定所有202场景可取|
|[Ego4D](https://ego4d-data.org/docs/start-here/)|真实第一视角、多种episodic memory任务、可按子集下载|数据及标注均需先接受许可；官方提示约48小时审批、凭据14天过期；主视频约7TB|真实泛化补充；不专为固定建筑空间重访，也不能把NLQ等任务直接当地点身份真值|
|[EgoMemory](https://egomemory.github.io/)|主页明确500题、实体／事件／行为三类、平均5.1证据片段及25.9小时回溯；40.2%为作者报告|本次主页Paper／Code／Benchmark链接均指向#，未取得可下载标注与评测文件|可借鉴评测设计；不能声称已收集500题，不能与EgoLifeQA混为同一benchmark|
|[EmbodiedScan](https://github.com/OpenRobotLab/EmbodiedScan)|空间对象框、occupancy、语言grounding；[数据准备](https://github.com/OpenRobotLab/EmbodiedScan/blob/main/data/README.md)要求分别取ScanNet／3RScan／MP3D／ARKitScenes|官方要求填表申请标注链接；项目CC BY-NC-SA 4.0不取代上游许可|适合空间语义补充，不是完整日常生活连续视频，第一轮接入成本偏高|

### 对建议11的必要修正

- “公开项目”“公开下载”“已在本机完成下载”“已有可信真值”是四个不同状态，不能互相替代。
- 143条AEA序列不等于143条长时生活记录；先按地点和活动筛选、实测时长，再组样本。
- Aria的RGB与SLAM单色相机不是本项目三摄rig，不能复制RGB或把跨时刻图像拼成同步左右视图。
- 位姿距离、对象框、semantic区域、人工房间标注和生活事件问答是不同真值，不允许互相替代。
- HSSD新版本已有可关节家具，值得后续使用；HM3D静态扫描无法直接生成“钥匙被真人拿走”的真实证据。
- “不需要新增预算”只表示本轮不付费调用模型；存储、渲染环境、人工标注和后续推理仍有成本。

## 本次本地收集与复现

已完成且逐文件hash校验的收集：

|样本|固定revision|实际文件／字节|
|---|---|---|
|ReplicaCAD Interactive|3e8c7fe5759f64bfcbc3882f9cdf6de97f82a06d|602文件，157,450,746字节；含91个scene配置，不是91座建筑|
|EgoLife小样本|143fb319be7aa5ae210c936bf4f0f3a86092afb0|3条DAY1原MP4＋1个QA JSON＋README，共5文件、35,775,545字节|

两者合计193,226,291字节（约184.28MiB），另有11份官方来源快照。目录为`datasets/realism-source-survey-20261024-v2/`，两项complete均为true；所有原始数据留在忽略目录，不进入git。

**实际EgoLifeQA文件含500题，但它不是同样宣称500题的EgoMemory。** 已核验字段包含query_time、target_time、四选项、answer、need_audio、need_name、reason等；这些答案／推理字段只供评测隔离使用，不能传给空间／问答模型。只有3条原片，尚未核对500题完整证据覆盖，绝不能将其作为已经可评分的500题包。

离线重新核验全部607个资产／原片文件的SHA256后，三个视频完整解码为352／600／600帧，均1408×1408、20fps，对应17.6／30／30秒，共77.6秒。检视首／中／末帧可见真实餐桌旁人物活动、手部遮挡、转头、亮窗过曝等；当前小样本没有充分跨房间重访覆盖，不能据此验收空间身份。

这是**官方发布版鱼眼视频**：带圆形黑边、已烧录的DAY／时间／人物标识，不是原始Aria VRS传感器文件。保留原件与水印，不私自裁切后冒称原始图；任何后续去畸变／裁切都需独立派生文件和变换记录。没有校准不能声称已获得等价三摄。

解码摘要与9格缩略图保存在`datasets/realism-source-survey-20261024-inspection-v1/`；缩略图只作人工查看，不进入模型或评测证据。当前环境有OpenCV但未安装habitat_sim，资产下载完成不代表已能渲染，尚未安装或变更环境。

工具位于`scripts/datasets/collect-realism-sources.py`，仅写新的忽略目录datasets，不下载模型、不安装Habitat、不改变实时服务。总资产规划上限220MiB，逐文件校验大小及HF Git blob／LFS SHA256；receipt记录来源URL、revision、实际字节、SHA256及完成状态。

```powershell
python scripts/datasets/collect-realism-sources.py datasets/realism-source-survey-20261024-v2 --replicacad --egolife-sample
# 仅在同一收集中断时使用；复核缓存hash，沿用既有revision，保留失败历史
python scripts/datasets/collect-realism-sources.py datasets/realism-source-survey-20261024-v2 --replicacad --egolife-sample --resume
python -m unittest tests.python.test_realism_source_collection
# 使用已有OpenCV环境离线校验全部原件，并完整解码三个视频；新输出，不改原件
.venv/Scripts/python.exe scripts/datasets/inspect-realism-samples.py datasets/realism-source-survey-20261024-v2 datasets/realism-source-survey-20261024-inspection-v1
```

v1目录保存原官方源码文档链接404的失败；改用已核实的发布文档页后使用v2目录。下载中遇到TLS EOF，保留失败，最多三次传输重试；不绕过鉴权／许可、不更换镜像冒充官方来源。**实际完成状态以receipt中的datasets[].complete和files为准，不以目录存在为准。**

## 建议的样本设计（尚未生成／评分）

### A. 可控仿真开发样本

先做10分钟接入验证，再考虑30–60分钟正式轨迹，不能靠循环复制同一段或拉长停顿冒充真实丰富生活。

- 独立渲染本项目三路真实视角，同时保留单摄子集，固定相机rig、分辨率、视角、采样率和曝光时间语义。
- 进出区域、反向重访、近似外观干扰、短时遮挡、明确的采集缺口。
- 至少3种对象状态链：桌面放置→拿走→抽屉内；柜门开→关；物体移到相似桌面。只有渲染中实际执行的事件才入真值。
- 保存连续仿真时钟、真实位姿、区域volume／边界、对象实例ID／变换／关节状态和事件生效时间。
- 首次运行前冻结开发／留出划分；同一公寓布局变体不能简单当跨建筑独立测试。

### B. 真实空间验证样本

用户取得AEA下载链接后，先选同一loc下2条有重叠路径的序列，再选不同loc作干扰。只取VRS、metadata、必要SLAM和校准，先不取大点云。保留原始device-time／timecode映射；同一loc共享坐标系，不把不同loc强拼坐标。

原图人工审核地点／边界真值，MPS仅作标注辅助；无足够证据的区域保持unknown。单摄视图保留左右缺失，不沿用机器人三摄假设。

### C. 真实长期记忆样本

EgoLife先读取少量连续原片验证解码、时间戳及字幕／音轨；之后根据预先冻结的问题与证据需求，下载完整必要时间范围。不能只取答案附近镜头再宣称连续长期记忆。EgoLifeQA原始答案只给评测器；caption、答案、人物路径标签不得泄露给空间生产者。

## 真值与输入隔离要求

公开输入仅含原图、采集时间、实际存在的视角及允许的传感器字段。位姿／区域／事件oracle与QA答案保存在评测私有文件，不能通过文件名、描述、系统prompt或候选ID泄露。提问时只允许此前已可见证据；未来才发生的状态不可提前用于答案。

分开报告：空间重访／误合并／误拆分、对象状态更新、事件顺序、无证据拒答、原图检索覆盖、延迟／费用。模拟oracle、来源辅助标签和独立人审标签必须标不同来源，不用模型预测当答案。

目前没有新的场景渲染、真实长期样本转换、独立人审真值或新模型成绩。下一步先完成资产与解码核验，再决定渲染运行环境与AEA获取，不重写现有方法2。
