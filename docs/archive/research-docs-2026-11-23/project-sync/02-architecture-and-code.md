# 架构与代码地图

路径均相对仓库根目录；以下为当前已知入口，不表示每个模块均集成在实时产品中。

## 当前组合实现【已验证】

|路径|作用与边界|
|---|---|
|`src/agent/spatial-fixed-group-agent.ts`|固定地点分组；候选组全成员/分页检查，保留冲突和unknown；本轮组合没有改其算法|
|`src/agent/pose-route-topology.ts`|独立位姿图、到访、地点间/地点内轨迹、正反向检索、运动摘要、JSON快照和缓存|
|`src/agent/fixed-pose-route-assistant.ts`|组合固定识别器＋新图＋说明Agent；识别接口传id/time，图像仍由原适配器提供|
|`src/agent/route-description-agent.ts`|计算结果到语言，检查index/turn/引用及窄范围方向矛盾；不是完整语义校验器|
|`scripts/datasets/prepare-fixed-pose-routes.py`|旧固定运行与原图hash绑定，追加完成前缀的官方pose；先造几何答案再冻结|
|`src/evaluation/fixed-pose-routes.ts`|建图/恢复/74几何检查/190连续性检查/可选真实正反向说明|

### 图的实际策略

- 每相邻已知观测之间保存全部连续pose；相同地点也存`within-place`，不同地点存`between-place`。
- 原始pose记录时间、XYZ、相机yaw、坐标系、录制ID及来源。
- pose间隙超过150ms、坐标/录制/来源切换不建立通路；unknown地点不创造节点，有连续pose时可保留实际跨越经历。
- 默认可逆，one-way可覆盖；反转样本顺序，不能把相机yaw简单加180°。
- 路线连接端点允许0.25m误差；同一地点标签不意味着端点重合。
- 后续边初始方向继承上一段行进方向；不是重置成当年的相机方向。
- XY折线简化阈值0.5m，方向NED正差向右，距离取整；不是精确人体动作指令。
- 缓存绑定边指纹、方向和初始朝向。JSON快照恢复已测试，不等于SQLite事务或真实跨进程系统恢复验收。

## 既有可复用资产【不混称】

|路径|实际作用|
|---|---|
|`src/agent/spatial-sqlite-service.ts`|SQLite空间worker、提交/修订等|
|`src/agent/spatial-sqlite-store.ts`|持久observations/places/assignments/visits/transitions/revisions|
|`src/agent/spatial-working-context.ts`|有界工作视图；默认recent6/anchors4/retrieved4，非原始长期存储|
|`src/agent/spatial-topology-service.ts`|JSON拓扑实现及共享类型，不是SQLite worker|
|`src/agent/spatial-visit-topology.ts`|旧访问转移/时间线索图；无运动轨迹就不保证可通行，不等于新位姿图|
|`src/agent/spatial-json-vlm.ts`|独立Qwen调用、PNG/hash验证、请求响应、费用预留与账本|
|`src/agent/spatial-protocol-retry.ts`|旧固定链有限协议纠错，最多初次＋2次；非所有新Agent默认策略|
|`src/dead-reckoning.ts`、`src/realtime-motion.ts`|已有运动资产，不能作为当前原始IMU主链接入证据|

## 保留但非当前主线

- `src/agent/route-experience-experiment.ts`、`src/route-experience-experiment.ts`：独立序列原型。
- `src/evaluation/tartan-route-qa.ts`：旧24题VLM角度/选路基线。
- `docs/product/vlm-imu-spatial-memory-closed-loop.md`：原闭环计划，参考原则仍有价值，但职责和反向策略以最新用户决定为准。

新图尚未接8884实时界面/硬件；未实现跨会话坐标对齐、merge/split图修订、完整语言安全门禁。不要只因目录里存在实现就称全链已上线。
