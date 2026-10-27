# IMU／位姿鲁棒性相关工作与本项目边界

## 总结

IMU抗噪／偏置、标定与失效恢复是成熟研究方向；“对IMU加噪后运行VIO”本身没有新颖性。要区分位姿估计端（如何估得更准）与空间记忆端（如何避免不确定几何破坏关联／证据）。没有全面查清后者就不能声称研究空白。

## 直接相关、可追溯工作

### VINSEval，ICRA2021

https://github.com/aau-cns/vins_eval
https://www.aau.at/wp-content/uploads/2022/07/VINSEval.pdf

专门系统扫描IMU噪声密度／bias随机游走、相机IMU时间延迟、纹理特征与光照，对OpenVINS、LARVIO、ROVIO、VINS-Mono做统计比较（含多次轨迹／环境随机化、ATE/NEES与breaking point）。它与我们当前VIO误差生成／鲁棒性评估最直接重叠；甚至报告过极低噪声引发VINS-Mono数值问题，不能假设噪声越低结果必定单调更好。仓库可见，README标为source-available且限制商业使用，不泛称无限制开源。

### OpenVINS，ICRA2020及后续校准扩展

https://docs.openvins.com/ ; https://github.com/rpng/open_vins

在线bias、相机内外参／时差、IMU内参与g-sensitivity标定、FEJ一致性、静态／动态初始化、ZUPT。它已在补偿IMU和标定误差，不能将本项目加噪+OpenVINS称为新的鲁棒估计算法。某些参数在退化运动中不可观测，在线估计不等于一定改善。项目GPL-3。

### VIO-IPNet，2025预印本／TIM2026

https://arxiv.org/abs/2503.12527 ; https://doi.org/10.1109/TIM.2026.3676182
https://github.com/yiyscut/VIO-IPNet

从原始IMU窗口学习平台相关bias先验，辅助视觉退化时的VIO，避免依赖递归bias估计传播错误。论文报告EuRoC/TUM-VI上的ATE/RPE改善，但不外推HM3D或任意运动平台。已核查仓库有train.py、inference.py、模型与配置，不把“仓库存在”当对应权重、完整VIO集成和许可证均已验证。

### TLIO，RA-L2020

https://cathias.github.io/TLIO/ ; https://github.com/CathIAS/TLIO
https://arxiv.org/html/2007.01867v3

人行头戴IMU的学习位移／不确定性与滤波器紧耦合，训练显式扰动bias和重力方向来提高鲁棒性。是学习惯导，不是裸双积分；学习的人行运动先验不直接适配任意机器人。论文实验使用外部初始速度／roll-pitch等初始化条件，不能和我们原生无GT初始化混为一谈。代码公开，未在本环境运行。

### mi-VINS，ICRA2019

https://pgeneva.com/downloads/papers/Eckenhoff2019ICRAb.pdf

多个IMU冗余、在线时空标定与base-IMU切换，针对单个IMU失效。不是多个相机，不能将它当成三摄关联方法。论文已核查，未核实可直接复现的官方仓库。

### ORB-SLAM3，T-RO2021

https://arxiv.org/html/2007.11898v2 ; https://github.com/UZ-SLAMLab/ORB_SLAM3

视觉惯性MAP初始化、bias估计、重定位、回环与多地图恢复，是实用的更强恢复对照；并非专门只研究IMU白噪声。回环后改写历史pose会产生因果性与记忆一致性问题，下游不能偷偷用完整序列优化后的位姿作为过去时刻在线输入。本轮不另外部署，先完成已有OpenVINS链路。

## 下游记忆：已有人研究pose噪声，不只是定位论文

### Episodic Memory Question Answering，CVPR2022

https://openaccess.thecvf.com/content/CVPR2022/papers/Datta_Episodic_Memory_Question_Answering_CVPR_2022_paper.pdf

研究噪声深度／pose／相机抖动对空间语义记忆与答案定位的影响。Fig5明确比较LoCoBot经验噪声扰动和视觉里程计估计的相对pose，不是完全从真实IMU原始测量传播的相同协议。任务输出为空间答案定位，与当前OpenEQA开放式回答不同。不能声称“空间记忆pose噪声”是我们首次研究。

### 容易误引的工作

- NoisyEQA：https://arxiv.org/html/2412.10726 ，主要是用户问题中物体／属性／语义假设的错误，不是IMU噪声。
- Robust-EQA（2023）：https://pubmed.ncbi.nlm.nih.gov/37028297/ ，主要是训练标签噪声，不是IMU测量。
- SpatialMem：https://arxiv.org/abs/2601.14895 ，版本变化较大，本轮检索到metric尺度扰动、分层证据记忆与强VLM对照等内容；尚未完成最新版正文核查，不将其描述为已做完整IMU鲁棒性研究。

## 对本项目的含义

可研究但尚未证明新颖的对象是：真实VIO估计误差怎样破坏跨朝向物体关联、快照证据归属与下游问答；与完全不使用pose的图像记忆基线相比，何种任务／历史长度／预算下3D结构值得使用。必须先把“估计更准”和“记忆对不准更宽容”分开，且保留强VLM与简单图像检索对照。
