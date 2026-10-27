# 位姿依赖与地点识别：源码核查

范围：已固定版本的 3D-Mem、Meta-Memory、GraphEQA 和 FindingDory；静态调用链核查，不是噪声实验。未据此给出厘米／角度容差。

## 3D-Mem

`vendor/3d-mem/src/scene_aeqa.py:197–214` 设置仿真 agent 后，从 sensor.position/rotation 组装 cam_pose；不是该模块从图像估计位姿。`:423–432` 将 depth、mask、K、trans_pose 输入 detections_to_obj_pcd_and_bbox；`:527` 起计算空间相似性再做关联。官方该仿真链路具有真值相机状态。位姿必须跨观察一致；旋转和相对漂移会影响对象点云对齐。不能从代码推断“必须厘米级”或已验证噪声鲁棒。不是由 VLM 单独决定每张图是否属于新地点。

## GraphEQA

`vendor/grapheqa/graph_eqa/envs/habitat.py:13–32` set_pose 后取深度相机位姿，调用 pipeline.step(timestamp, translation, quaternion, depth, labels, rgb)；`envs/habitat_interface.py:542` 从 agent.get_state().sensor_states 取相机状态；`occupancy_mapping/tsdf.py:233–263` 依赖 cam_pose 做坐标变换。实机 `stretch_ai_agent/robot_hydra_agent.py:801` 则使用 obs.camera_pose。仿真参考不是带噪 VIO；实机存在外部位姿接口，但未由此证明任意漂移可接受。几何图／占据图需要一致度量坐标，不能和纯视觉地点判别等同。

## Meta-Memory

`vendor/meta-memory/meta_memory/memory/milvus_memory.py:43` 将 position 存为三维向量；`:148–174` 建位置检索并按位置向量近邻查询，search range 在此主要用于决定 k，并非本段实现严格半径裁剪。应纠正此前“范围外直接过滤”的过度概括。`scripts/eval.py:175` 成功阈值为15m。没有上述稠密3D融合的同等精度要求，但位置索引及坐标输出仍依赖一致位置。不能用15m评分阈值倒推可容忍15m定位噪声。

## FindingDory

官方 README、论文描述为经验采集后完成历史相关目标导航；它不是视觉地点识别 benchmark。

- `vendor/findingdory/findingdory/policies/end_to_end/qwen_imagenav_agent.py:167–190` 缓存观察和 agent state，高层根据历史图像选 frame index。缓存状态不代表全部 state 都输入 VLM，需逐条审查后端和提示词。
- `task/findingdory_task.py:682–696` 利用模拟器 semantic regions 和 is_robot_in_room 追踪房间访问，属于环境真值／评分侧。
- 高层可以通过历史图像直接选目标；没有强制提交地点ID、地点聚类或旋转前后 same-place 判断。
- 房间访问任务需要场所级理解，但不等同于要求每个方法运行独立地点识别模块。

因此它可能间接暴露错关联造成的目标错误，但不会直接、充分评价地点身份稳定性。GPS／Compass 等特权定位若保留在系统输入中，还可能降低视觉地点关联难度。

## 对实验结论的影响

需要分开：绝对坐标精度、相对几何一致性、朝向精度、视觉地点身份。全局统一刚体变换不必破坏地图；跨时漂移、朝向错误、尺度不一致、重置通常更关键。

原地转身＋准确位姿时，几何方法没有理由仅因图像不同就新建地点；也可能因检测／遮挡产生其他错误。三摄不会在保持相同外部位姿的情况下自动修复共同几何误差，更不能默认它们存在 First Sight 的同一种 VLM 地点判别环节。

保持 FindingDory 任务结果为应用评测；增加独立跨朝向关联诊断；对各方法使用其原生对象／观察关联输出，不强迫它们伪装为相同地点分类器。先测噪声敏感性再决定支持哪些“位姿不精确仍鲁棒”的论断。
