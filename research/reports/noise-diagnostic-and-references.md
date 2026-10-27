# 首轮误差诊断与参考

已运行 `python research/scripts/pose_sensitivity.py`，输出 `pose-sensitivity-diagnostic.json`。这是解析几何／位置kNN玩具诊断，不是任何上游算法运行，不是任务成绩，不是IMU仿真。

固定地标距相机5m，第一观察正确，第二观察原地旋转；深度与外参准确，只污染第二次设备朝向：2°/5°/10°误差分别造成0.175/0.436/0.872m的重建位置偏差。每格100个随机朝向／漂移方向，固定seed。扫描包括2/5/10m距离、0/2/5/10°朝向、0/0.25/1m平移漂移。

在所有相机共享同一错误设备位姿、都看到同一地标的理想条件下，三摄简单平均没有消除此共同偏差。这里有意不模拟视野覆盖，不能据此说三摄对真实记忆无益。kNN玩具也只展示相对坐标误差可能改变排名，不代表Meta-Memory实际召回率。

## 两种相关参考，不能混同

- RobustNav (ICCV2021): https://arxiv.org/html/2106.04531v1 ; https://github.com/allenai/robustnav 。RoboTHOR上测试视觉与动作动力学损坏，含模糊／低光／缩小视野、每episode固定动作偏差、逐步随机动作偏差、前进偏航和转向动作失效；以clean/corrupt配对的SR/SPL及碰撞／停止错误分析。改变真实动作执行，不等于只污染估计位姿，更不是原始IMU模型。不能确认就是用户记忆中的那篇。
- OpenVINS simulator: https://docs.openvins.com/simulation.html ; https://github.com/rpng/open_vins 。SE(3) B样条连续轨迹生成惯性和视觉bearing；IMU测量加白噪声与随机游走零偏。噪声密度离散测量项按1/sqrt(dt)，零偏增量按sqrt(dt)。内建视觉是特征投影，不是Habitat RGB渲染；接本项目需将同一连续轨迹接到图像生成。

## 后续尚需完成

实际上游依赖和数据仍未齐备，不可称已测3D-Mem／GraphEQA／Meta-Memory。完成原生小样后统一记录输入位姿与扰动，在对应投影／地图融合／位置索引入口注入；先测固定图像的位姿误差，再测连续轨迹原始IMU+VIO，最后单／三摄对照。统计重复对象、错融合、证据召回及任务结果，并保留共同刚体变换不应改变内部几何的负对照。
