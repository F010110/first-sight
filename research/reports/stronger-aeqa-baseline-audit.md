# 更强A-EQA基线核查与决策

## 用户追加开源硬约束后的最终决定

不考虑尚未核实开源的R4，主线回到3D-Mem与真实传感器噪声实验。以下发现不支持“完全没有更强开源方法”，但当前没有找到既显著跃升到R4量级又符合通用Qwen API／不部署本地小VLM约束的替代方案。

- Pred-EQA：https://github.com/yuanrr/Pred-EQA ，已公开实现。CVPR2026论文主表53.3／48.5（Qwen3-VL8B），规模表最高56.3／53.9（32B），对照3D-Mem52.6／42.0，正确性提升有限且backbone不同。正式论文：https://openaccess.thecvf.com/content/CVPR2026/papers/Yuan_Predict_Before_You_Explore_Predictive_Planning_with_Specialized_Memory_for_CVPR_2026_paper.pdf 。
- Prune-Then-Plan：https://github.com/NoahFrahm/Prune-Then-Plan ，代码、校准数据入口可见。https://arxiv.org/html/2511.19768 表1 OpenEQA29.2→34.3采用视觉grounding增强评分，不能与52.6直接比较；算法依赖候选token概率和模型专属ECDF校准，不能拿自报置信度替换冒充原方法。
- SAGE：https://github.com/FrankZxShen/SAGE ，MIT、训练／评测代码公开。https://arxiv.org/html/2605.10118 报告4B A-EQA60.2／47.2，对照引用3D-Mem52.6／42.0，但新结果使用Qwen3-235B裁判，并非同裁判配对。其方法需RL训练专用Qwen3-VL策略，README要求训练与vLLM部署；未核实可直接下载的对应训练权重。通用Flash API替换会丢掉其学习策略核心，不属于忠实复现，因此当前约束下不切换。不能把SAGE描述为无开源或无性能提升。
- SCOPE当前公开README与入口主要为GOAT-Bench，不以导航成功率代替A-EQA高分依据。ObsGraph仍未定位到可确认官方实现。

本轮只作资料核查与决策更新，未运行新噪声实验；后续保留26题与Flash／Plus控制，噪声须来自IMU测量模型／偏置／初始化／标定误差并经估计或积分传播，不直接硬加输出漂移。

## 结论

不能维持“HM3D主动问答没有明显高分方法”的判断。新核查R4（CVPR 2026）正式论文，表2报告A-EQA HM3D LLM-Match74.00、SPL63.37；引用3D-Mem52.6／42.0。表4的184题单智能体实验为72.82／61.47，协作为73.91／70.13。两张表不同配置的具体差异未核实，不能混用，也不能称74.00已经由本项目复现。

论文正式版PDF已保存r4-cvpr2026-paper.pdf。来源：https://openaccess.thecvf.com/content/CVPR2026/papers/Sohn_R4_Retrieval-Augmented_Reasoning_for_Vision-Language_Models_in_4D_Spatio-Temporal_Space_CVPR_2026_paper.pdf 。arXiv https://arxiv.org/html/2512.15940v1 。不是把EM-EQA或多选题成绩误当当前A-EQA：74.00明确位于主动问答列。

FAST-EQA (WACV2026) 表1在同一A-EQA184任务为49.0±1.7，不能因为HM-EQA多选题69.2就声称显著超过3D-Mem。来源https://arxiv.org/html/2602.15813 。ObsGraph先前报告54.5（同配置重跑3D-Mem49.6），幅度小于R4。

## 复现可行性与阻塞

R4正式版称所有代码将在发表时开源，但本轮论文、CVPR官方页面、精确标题／arXiv号代码搜索未定位到可确认的官方仓库。这是“尚未找到”，不是证明没有开源。不能编造仓库或用自写简化记忆冒充作者完整实现。

论文使用MapAnything、SAM2 Hiera Large、Gemma3-4B-IT。沿用用户约束仍应Qwen API替换VLM，不启动本地小VLM；替换后属于方法适配而非74分数值原样复现。尚缺完整导航策略、提示／检索手册、停止预算等可执行配置，须补齐后才能运行。

按用户条件分支：优先目标改为R4单智能体复现可行性与代码审计；保留3D-Mem所有26题基线，暂不启动噪声实验。当前是有更强论文结果但代码阻塞，不属于“没有更强算法所以开始噪声”分支。未启动新的付费推理或实验。
