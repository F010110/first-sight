# ReplicaCAD真实渲染与事件样本试作 v1

状态：接入开发，不是新评测结果。沿用[来源核查](realistic-sample-source-survey-2026-10-24.md)固定revision的CC BY 4.0资产。不改空间算法、不运行付费模型、不配置硬件网络。

## 环境隔离

WSL Ubuntu能识别RTX4060。已有run/habitat-runtime是headless_nobullet构建，不能直接声称能实现开合家具／物理事件。本阶段使用独立run/environments/habitat-v033，安装Habitat0.3.3、Python3.9、headless＋Bullet，不修改旧环境或Windows Python。

复用现有sim/hssd/setup_habitat_environment.py，增加可选环境名及Bullet安装，不新增同名包装脚本。在WSL仓库根目录运行：

```bash
python3 -m sim setup_habitat_environment --root run/environments --env-name habitat-v033 --with-bullet
```

安装不是GPU渲染验收：需真实加载场景、校验非空图及OpenGL renderer，不能把nvidia-smi识别设备等同于Habitat实际使用GPU。

## 第一关：技术渲染smoke

```bash
run/environments/habitat-v033/bin/python -m sim replicacad_smoke \
  --dataset datasets/realism-source-survey-20261024-v2/ReplicaCAD_dataset \
  --output run/replicacad-pilot/render-smoke-v1 --scene apt_1 --egl-default-device
```

- seed11，原navmesh上选择非平凡连通最短路径，最多20个观察，路径插值步长≤0.25m；仅作技术检查，不是生活轨迹。
- 同一场景状态独立渲染front／left／right，640×480、水平FOV90°、yaw0／+60／−60°、高度1.6m。这是理想针孔rig，不冒称匹配未标定硬件广角。
- 独立图像hash；三视图像素相同或空图即失败。采样位姿必须在navmesh上；机器人navmesh不证明人体／头部碰撞条件。
- public/observations.jsonl只含中性ID、合成采样时间、真实视图与图像hash，无位置／scene／房间／对象ID／答案。
- private存代码／收集receipt hash、场景／seed、位姿及失败／完成回执，regionTruth保持null，不按距离伪造房间身份。
- 500ms仅合成时钟，无真人曝光／行走真实性承诺，不能把20帧拉长当10分钟。

## 第二关：10分钟事件样本准入条件

第一关成功后才绑定真实存在的物体与关节，预先冻结事件和留出规则。不先写剧情再把没实际发生的事件当真值。

1. 验证支持面、对象包围盒、抽屉关节和碰撞。未验证手部动作时，只叫“受控对象／关节状态变化”，不冒称真人拿取。
2. 实际改变仿真状态并保存变换／关节读回值；配对渲染事件前后画面，核验目标可见，不以事件文字替代视觉证据。
3. 全场景oracle与相机可见证据分开；关抽屉后不能让模型透过oracle知道内容。问题需要此前原图支持。
4. 路径连续、转向有界，停顿／缺口显式记录；不循环复制成功前缀。站立／低头／遮挡等另核验。
5. 单公寓变体不是跨建筑留出；AEA真实数据仍独立保留。

## 验证原则

纯Python采样、朝向、非法步长测试不依赖Habitat。运行失败必须保存，不能静默换scene／seed直到图像好看。渲染完成后记录图像数量、renderer、导航／图像核查；尚未出图时不能宣称真实事件样本完成。
