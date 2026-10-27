# IMU真实误差：设备规格与对比试验设计

状态：资料核查／设计，尚未启动新噪声实验。沿用3D-Mem冻结26题、Flash作答与Plus评分。仅数据手册约束的模拟不能称已复现某实物整机的误差分布。

## 1. 边界与单位

IMU输出三轴角速度和三轴比力，不直接测位置。a_m = M_a R_WI^T(a_W-g_W) + b_a(T,t) + n_a；w_m = M_g w_I + b_g(T,t) + G_g f_I + n_g。M包含尺度和非正交，G为陀螺加速度敏感性。设备安装／相机外参与内部轴间非正交要分开。

零输入偏置、启动／跨运行重复性、运行中bias instability、温度变化、偏置随机游走扩散强度是不同参数。特别是deg/h的bias instability不能直接填OpenVINS的gyroscope_random_walk，单个Allan最低值不唯一决定随机过程的时间相关性。出厂容差±x不自动等于高斯1sigma，也不应作为每一帧独立扰动。

1mg=0.00980665m/s²，1ug=9.80665e-6m/s²；1deg/h=4.8481368e-6rad/s；1%=10000ppm。噪声密度不是单样本RMS，采样率也不等于噪声带宽。

## 2. 可追溯型号（档位为应用定位，不是统一认证）

| 型号／定位 | 陀螺噪声 deg/s/√Hz | 加计噪声 ug/√Hz | 运行中陀螺bias稳定性 | 加计bias稳定性 |
|---|---:|---:|---:|---:|
| MPU-6050，旧消费器件 | 0.005 | 400 | 本轮未核实可用规格 | 本轮未核实可用规格 |
| BMI088，机器人／无人机MEMS | 0.014 | X/Y160、Z190（手册指定条件）；官网简表175 | 本轮不以未核查Allan模型补数 | 同左 |
| ICM-42688-P，现代低噪消费／机器人 | 0.0028 | 约65–70，概述70 | 本轮未核实可用规格 | 本轮未核实可用规格 |
| ADIS16470，工厂校准工业模块 | 0.008 | 100 | 8deg/h | 13ug |
| ADIS16495-1，战术级模块 | 0.002 | 17 | 0.8deg/h | 3.2ug |

以上为厂商给定条件下典型值或明确统计定义，不是同温度／滤波／封装／标定条件的整机横评。ADIS16495-2／-3量程与噪声不同，不借用-1的最优数值；-1仅±125deg/s，需检查轨迹转速是否饱和。ICM白噪声小于部分工业模块不矛盾，等级不能按一列排序。

原始／静态系统误差例子：

- MPU-6050：25°C陀螺初始ZRO容差±20deg/s、加计XY约±50mg/Z±80mg；陀螺尺度容差±3%。这是未进行用户标定的容差，不是正常标定后应直接注入的残差。
- BMI088：零偏概述加计±20mg、陀螺±1deg/s；TCO加计约0.2mg/K、陀螺0.015deg/s/K；陀螺尺度容差±1%、轴间串扰约1%。手册加计噪声160/190与官网175是条件／汇总差异，应锁定具体手册版本和配置。
- ICM-42688-P（DS-000347 v1.6）：陀螺初始ZRO典型容差±0.5deg/s、TCO±0.005deg/s/°C、尺度初始容差±0.5%、尺度温度变化±0.005%/°C、板级cross-axis约±1.25%。
- ADIS16470 Rev.C：陀螺尺度跨温误差±0.25%、轴间失准±0.1deg；加计尺度跨温误差±0.1%。温区-10至75°C内陀螺bias误差0.2deg/s、加计±4mg（1sigma栏）。这不是每°C斜率，不能与消费芯片TCO逐数直接比较。
- ADIS16495 Rev.C：-1陀螺尺度跨温误差±0.2%、轴间失准±0.05deg；加计尺度跨温误差±0.01%、轴间失准±0.035deg。全温区bias误差陀螺±0.1deg/s、加计±0.5mg。其repeatability注释含500小时HTOL长期老化条件，不能误当逐次启动零偏sigma。

## 3. 模型实现要求

偏置拆分b=b_fixed+b_slow(t)+k_T(T-T0)，也可使用经测量拟合的非线性温度曲线／迟滞。fixed每次运行抽一次；scale／非正交每个虚拟设备固定；热漂慢变；白噪声逐样本变化。多轴相关和加计／陀螺时序不能被独立逐图pose噪声替代。

按Kalibr／OpenVINS连续噪声定义：white sample std=sigma/sqrt(dt)，bias RW increment std=sigma_b*sqrt(dt)。厂商单边ASD与库连续协方差可能有√2约定差异，必须用实测RMS／有效噪声带宽及Allan曲线验证，不机械照搬数字。例如ADIS16470 ARW0.34deg/√h与rate ASD0.008deg/s/√Hz是应交叉核查的一对，不能无说明按60倍关系同时硬匹配。

运行中bias若用一阶Gauss-Markov：b[k+1]=exp(-dt/tau)b[k]+sigma_stationary*sqrt(1-exp(-2dt/tau))*z；tau与stationary sigma需联合拟合Allan／自相关，而非令sigma_stationary等于厂商bias-instability后即宣称真实。真实bias常有1/f区域，单RW或单GM只能是有限时间近似。

传感器带宽、量程、量化和时间戳／滤波延迟显式记录。有效噪声带宽B下单边ASD N对应RMS=N*sqrt(B)，真实滤波产生时间相关，不能降低输出频率后随意抽样。相机同步误差与外参误差另列系统因素，不凭IMU价格给出“实测等级”。

## 4. 对下游特别敏感的非器件参数

- 初始roll/pitch误差使重力漏入水平加速度：小角度a_err≈g*theta；yaw误差对静态重力分离无同等一阶效应。静止六轴初始化不能独立分离全部加计bias与倾角，静止单姿态不够完成全标定。
- 初始速度误差线性积累位置，重力大小误差造成二次积累。实际地点重力与9.80665标准值不同；仿真必须先用同一重力验证，再单独做模型失配消融，不能无意算入器件档位。
- 时间偏移dt造成角度约w*dt、平移约v*dt；例如90deg/s与5ms产生0.45deg角度错配。这是系统级示例，不是某芯片实测指标。
- 滤波器参数与物理噪声分离。估计器Q膨胀只是建模保守程度，不代表真实传感器变差。

## 5. 实验路线

1. 以BMI088／ICM42688代表轻量机器人设备、ADIS16470代表校准工业模块、ADIS16495-1代表高端参考；MPU6050只作为旧低端补充。每个型号沿用自身规格，不拼接多个设备的最佳指标成“高级IMU”。
2. 先做恒温、经初始化、标定一致条件，研究white＋slow bias；有实测Allan或公开同型日志才冻结slow bias系数。无依据系数仅能标为灵敏度扫描，不能称型号实物复现。
3. 再单独做冷启动温升、尺度／非正交标定残差、初始化误差、同步／外参误差。实际温升曲线最好来自设备，暂缺时只能标为假设工况。不把全部最坏值同时叠加当“典型”。
4. 连续物理轨迹生成IMU，至少统一如200Hz IMU与20Hz图像（最终依设备与算力冻结）。Habitat离散瞬移／原地跳转不能直接差分成真实IMU；插值轨迹需限速、限加速度／角速度并检查碰撞，不穿墙平滑。物理时间不能用API等待时间或程序墙钟时间代替；若模拟机器人等待则显式静止采样。
5. 先做同轨迹离线回放，固定图像／检测／问答预算，分别比较GT pose、纯惯导（诊断上界／失锁段）、视觉惯性估计（主实验）。同一IMU输入送给被比较方法；不把单纯积分巨漂当正常VIO漂移。
6. 真正视觉VIO与现有OpenVINS合成无漏匹配特征测试区分。后者只能隔离惯性与估计器效应，不能称已跑完HM3D真实图像VIO。主线不得利用GT重置估计pose；若导航仍借助GT pathfinder须明确仅研究记忆噪声，不宣称全自主噪声导航。
7. 最少3个预注册种子做初筛，正式建议5个或更多；低成本位姿回放优先增加种子。记录RPE/ATE（对齐方式明确）、相对朝向、bias估计、失锁率，再进入固定26题Plus评分；不按答题分数挑误差强度。

## 6. 数量级自检（不是设备预测）

不受约束的纯积分、小角度、短时近似：水平加计常bias1mg时0.5*b*t²，10s约0.49m、60s约17.65m；初始roll/pitch误差0.1deg时0.5*g*theta*t²，10s约0.86m；未补偿水平陀螺bias0.01deg/s时g*b*t³/6，10s约0.285m、60s约61.6m。实际视觉纠偏／ZUPT显著改变结果；这些只用于检验物理量与单位，不是人为设定pose漂移。

## 来源

1. TDK MPU6050官方规格（旧消费件／noise）：https://product.tdk.com/en/search/sensor/mortion-inertial/imu/info?part_no=MPU-6050 ；原手册镜像https://cdn.sparkfun.com/assets/a/4/6/8/e/MPU_6050.pdf 。
2. Bosch BMI088官方页面https://www.bosch-sensortec.com/en/products/motion-sensors/imus/bmi088/ ；手册https://www.bosch-sensortec.com/media/boschsensortec/downloads/datasheets/bst-bmi088-ds001.pdf 。
3. TDK ICM42688P DS-000347 v1.6：https://product.tdk.com/system/files/dam/doc/product/sensor/mortion-inertial/imu/data_sheet/ds-000347-icm-42688-p-v1.6.pdf 。
4. ADI ADIS16470 Rev.C：https://www.analog.com/media/en/technical-documentation/data-sheets/adis16470.pdf 。
5. ADI ADIS16495 Rev.C：https://www.analog.com/media/en/technical-documentation/data-sheets/adis16495.pdf 。
6. Kalibr：https://github.com/ethz-asl/kalibr/wiki/IMU-Noise-Model 。
7. OpenVINS：https://docs.openvins.com/gs-calibration.html 、https://docs.openvins.com/simulation.html 。静止长期采集约20小时为其建议，不能凭几分钟数据可靠估计长期bias随机过程。
8. VectorNav等级／误差预算：https://www.vectornav.com/resources/inertial-navigation-primer/theory-of-operation/theory-inertial 、https://www.vectornav.com/resources/inertial-navigation-primer/specifications--and--error-budgets/specs-inserrorbudget 。其分级表是示意值，非任意实物规格，不用表中“60s漂移400m”直接生成我们的pose。
