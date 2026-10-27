# 空间／情景记忆：Direct VLM应与谁比较

## 结论与边界

主比较应从主动导航转向“固定历史观测上的证据找回与问答”：Direct VLM vs 图像检索、视频RAG、摘要／事件记忆与工具搜索。3D-Mem保留为空间建模鲁棒性支线，不作为Direct的唯一或主要对手。同一输出任务下仍可比较3D与非3D记忆；不能把Direct未提供的导航能力算成记忆检索失败。

“暴力”须拆开：①上下文容纳时按固定采样输入全部历史；②超出上下文后逐批穷举、保存候选原图／时间并统一复核。后者已有有损中间结果，不是无限上下文，也不能只计算最后一次合并成本。所有方法都应保留来源时间与证据帧。

## 代表性文献与对手

| 工作 | 表示与任务 | 对本项目的用途 |
|---|---|---|
| ReMEmbR，2024 | caption+时间／位置索引、迭代检索；NaVQA时空问答和机器人应用 | 最贴近机器人历史记忆；有Multi-Frame VLM对照，但本身不是pose-free |
| VideoAgent（Wang等），ECCV2024 | LLM按问题迭代寻找视频证据／选帧 | 对比穷举与自适应搜索 |
| VideoAgent（Fan等），ECCV2024 | 事件文本、对象跟踪及工具查询的结构化记忆 | 对比原图与有损事件／对象表示；不可与上者混同 |
| VideoTree，CVPR2025 | 查询自适应、粗到细树状表示与选帧 | 对比层次搜索；主要长视频QA，不是三维地图 |
| EgoButler / EgoRAG，EgoLife，CVPR2025 | 小时／日层级记忆与检索，长期第一人称问答 | 对比摘要压缩与原始证据回访 |

这些均有公开代码入口，但仓库存在不代表已在本机复现，也不保证原生依赖完全符合Qwen API约束。替换作者使用的模型后须称API适配版，不能直接沿用论文成绩。暂不部署新模型。

ReMEmbR短历史中直接多帧VLM可相近或更好，长历史中检索更稳定且省时；VideoTree等也报告优于当时直接VLM。SuperMemory-VQA同模型实验中Video-RAG总体优于EgoButler；额外工具调用不自动更好。这些支持比较条件和预算，不支持预设Direct普遍获胜。

## Direct更可能占优的问题：待验证假设

- **未预先定义的视觉细节**：包装文字、颜色、图案、物体局部；caption可能从未保存这些属性。必须输入足够分辨率，缩略图穷举不保证能读字。
- **短暂动态状态与事件**：谁移动了物体、打开前后、最后出现；静态融合或时间摘要可能覆盖变化。最后出现问答必须保留时序。
- **稀有、难命名或漏检的对象**：原图仍含证据，依赖检测类别／caption的记忆可能丢失；但语义检索也可返回原图，不能笼统称RAG丢失细节。
- **事后新问题和非典型关系**：新问题所需线索不在预建摘要中；穷举减少检索遗漏，但不消除VLM识别和推理错误。
- **短到中等历史、低查询次数**：无需支付复杂建库成本；长历史、多次查询则建库可摊销，Direct可能更贵。
- **同图位姿漂移**：不输入pose的Direct不受数值pose误差直接影响；但pose-free图像RAG同样有这个优势，它不是Direct独有贡献。

不预期Direct天然擅长精确全局距离、坐标一致性、不可见空间推断和执行导航。没有看见的证据，多摄或任何搜索都不能凭空补出。

## 数据与任务建议

1. **首选任务：物体／事件回忆，答案+证据时间段。** Ego4D Episodic Memory的NLQ输出时间段；VQ是物体最后出现与2D轨迹（并非普通自由问答）。使用其官方指标，不把NLQ、VQ混成一个QA分数。
2. **问答候选：SuperMemory-VQA。** 52.9小时、4853题、10人，包含物体位置、视觉细节、对话、上下文、时间线、意图，有证据与不可回答项。纯视觉实验应使用预先定义的视觉可回答类别，并公开排除规则，不能在看结果后删题；完整多模态成绩需提供对应音频／转录。数据许可、访问与实际下载尚未核实。
3. **长历史压力测试：EgoLifeQA。** 原论文3000题，数据约266小时保留（项目常称约300小时采集）；规模不适合直接全量启动，先做明确采样和预算协议。
4. **空间能力补充：VSI-Bench。** 288段室内视频、5000余题，覆盖方向、距离、尺寸、数量和顺序等，无执行导航。适合检验非3D方案的空间能力边界，不替代导航成功率。

## 最小可解释验证设计（建议，未运行）

固定同一份时间序列与作答模型，比较：全历史Direct、分批穷举、图像Top-K检索、一个公开视频记忆方案。优先VideoAgent的搜索思路或ReMEmbR的时间索引思路，依据代码／API适配成本再选一个，而非全部部署。Top-K选择器与预算也须冻结，不能看错题后调参。

预先区分细节、最后出现／变化、相似物体区分、空间关系，按历史长度与查询次数分层。记录答案、证据召回／定位、不可回答校准、全部建库和查询token／耗时／存储。报告同观测实际成本和匹配预算两种比较；超上下文、超时和失败保留分母。

空间记忆的IMU鲁棒性仍是独立配对实验；多摄先分别报告“证据是否进入观测”与“已有证据能否找回”。固定相同定位输入，比较同路线单摄／同步多摄，再做同图数或token预算控制。单路RGB+双SLAM灰度流并不等于三个同等语义摄像头，下载与视场核实前不声称现成数据已支持三摄实验。

## 来源

- ReMEmbR：https://arxiv.org/abs/2409.13682 ；https://github.com/NVIDIA-AI-IOT/remembr
- VideoAgent（Wang）：https://arxiv.org/abs/2403.10517 ；https://github.com/wxh1996/VideoAgent
- VideoAgent（Fan）：https://videoagent.github.io/ ；https://github.com/YueFan1014/VideoAgent
- VideoTree：https://github.com/Ziyang412/VideoTree
- Ego4D：https://ego4d-data.org/docs/benchmarks/episodic-memory/
- EgoLife：https://egolife-ai.github.io/ ；https://github.com/egolife-ai/EgoLife
- SuperMemory-VQA：https://arxiv.org/html/2606.00825v1 ；https://github.com/AIoT-MLSys-Lab/supermemory-vqa ；https://huggingface.co/datasets/OSU-AIoT-MLSys-Lab/SuperMemory-VQA
- VSI-Bench：https://vision-x-nyu.github.io/thinking-in-space.github.io/ ；https://github.com/vision-x-nyu/thinking-in-space

本报告是文献与实验方向梳理，不是新基线跑分或新数据可用性验证。既有HM3D26题、Direct两题先导保持原样，不用其结果筛选新任务。
