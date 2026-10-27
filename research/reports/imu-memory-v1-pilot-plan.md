# 首轮IMU输入噪声实验：执行方案

## 执行状态

已准备独立runtime并启动9运行先导（首3题×GT/BMI-like/MPU-like，噪声种子0）。原26题冻结runtime和结果不修改。不是已经取得9次结果。没有多GPU并发，避免8GB显存OOM。

## 冻结输入强度

| 条件 | 陀螺单边ASD °/s/√Hz | 加计单边ASD ug/√Hz | 初始残余陀螺偏置每轴sigma °/s | 初始残余加计偏置每轴sigma mg |
|---|---:|---:|---:|---:|
| GT | 0 | 0 | 0 | 0 |
| BMI-like | .014 | 175 | .003 | .1 |
| MPU-like | .005 | 400 | .01 | .5 |

白噪声参考手册；偏置是明确选择的较小标定后残差，不是从出厂容差直接推导，也不是指定型号实测。慢偏置为100秒相关时间GM，stationary sigma为上述残差sigma/3；这是灵敏度工况假设，不称设备识别。MPU-like陀螺白噪声低于BMI-like，不能声称所有误差分量逐档增大。正式扩展应另加同bias的white-only对照以分离原因。

## 注入位置与边界

1. 真值相机观测姿态之间沿navmesh路径生成连续quintic停走轨迹；在原地先转向再沿路径移动，200Hz生成陀螺角速度与加计比力。峰值速度0.5m/s、加速度1m/s²、角速度90deg/s、角加速度180deg/s²。相机与IMU设为共点，时间为假设运动时间，不使用API等待时间。
2. 每个测量加white＋固定残余bias＋slow bias，再用纯strapdown积分产生pose。初始pose已知、初始velocity零，之后不重置、不截断漂移、不用GT纠偏。采样std=单边ASD/sqrt(2dt)，对应理想Nyquist带宽；不同时额外叠加ARW。
3. 估计pose用于完整3D-Mem对象反投影、关联、实际融合与对象距离过滤；periodic cleanup和snapshot附近对象选择使用估计位置。完整原生去噪／合并／层级快照保留；不再使用早期未融合的简化关联脚本。
4. 渲染、TSDF、frontier/pathfinder使用GT，是记忆侧干预，不是全部噪声导航。选择快照后其空间位置可能因记忆而影响目标导航，因此轨迹允许分叉，不能把最终差异全部归为同图下纯融合差异；记录图像hash定位首次分叉。
5. 纯IMU首轮是漂移传播／失锁工况诊断，不是正常VIO。不能因为它出现巨大位移就声称同设备真实视觉惯性系统也会如此。后续增加视觉更新条件时需另版本。

## 过程指标

- 全部原始／含噪IMU测量及bias：trace/imu.csv.gz；pose真值与估计、速度、物理时间：poses.jsonl。
- 每帧RGB/depth hash：observations.jsonl，用于确认视图何时开始分叉。
- 原生每次匹配中det→existing/new结果：associations.jsonl。实际融合后的对象id、类别、观测次数、中心、extent、点数，以及cleanup／snapshot状态：memory.jsonl。
- VLM每次决策类型、选中快照、回答、预筛数量、frontier数量：decisions.jsonl；类别筛选细节继续在run.log，保留API输入hash和token用量。
- 对象数／新增数不是实例正确率，没有GT实例标签，不用它们冒充ARI或绝对错误合并率。
- 原官方提示、Flash作答、独立Plus评分；无答案保留，评分异常标None不丢分母。每运行50步、110请求、3600秒上限，与原基线相同。GT重跑提供本轮仪器化对照，不只拿旧答案比。

## 已通过的启动自检

test_imu_memory_noise.py：零噪声纯积分往返轨迹误差小于2mm／旋转1e-5rad，种子重复性，连续传播不自动GT重置，ASD单位约定，3个测试通过。新runtime4个关键文件语法检查通过；CUDA可用。

## 结果位置及后续

research/runs/imu-memory-v1-pilot/<qid>/<condition>/；进度reports/imu-memory-v1-pilot-progress.json；执行协议reports/imu-memory-v1-protocol.json。用scripts/summarize_imu_memory_experiment.py生成过程曲线与同图快照比较（只分析已结束运行，无新API）。

先检查这9运行的误差量级、融合是否正常、失效点及GT差异，再扩展固定26题与多个种子；先导3题不能报告全26题噪声成绩或统计显著性。下一阶段应包括同轨迹回放和视觉纠偏，避免把探索分支或纯积分发散误当一般记忆鲁棒性结论。
