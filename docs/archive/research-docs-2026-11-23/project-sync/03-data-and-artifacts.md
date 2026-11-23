# 数据与工件

## TartanGround来源与完整归档

固定HF revision：`388faf9c800568cfc6828fa47e063f8369397eb3`；ModernCityDowntown/Data_omni。数据CC BY 4.0，不等于底层游戏工程可自由分发。机器人仿真轨迹，不是视障真人步行。

|材料|已知规模/质量|入口|
|---|---|---|
|P0001三摄|1129组/3387图；首末跨度112.8s；均速约3.43m/s，不适合直接称视障步行|`run/replicacad-pilot/tartanground-moderncity-p0001-v1`|
|P0006三摄|1504组/4512图；跨度150.3s；均速约1.54、速度中位约1.19m/s；完整三路归档/hash/CRC/解码/索引检查|`datasets/tartanground-moderncity-P0006-complete-v1`、`run/replicacad-pilot/tartanground-moderncity-p0006-v1`|
|原始pose|front/left/right等pose及四元数，0.1s间隔|`datasets/tartanground-moderncity-speeds-v1/P0006-metadata.zip`|
|RGB点云与底图|约246MB点云、路线/GeoJSON/5m网格；稀疏，不是测绘平面图|`datasets/tartanground-moderncity-map-v1`|
|语义点云|约1.03GB，只检查头；未完成下载|不能当本机现成完整标注|

原图与视频保留；MP4只是浏览器回放，不改原始采样时间，慢放也不产生新有效时长。

### 原固定版准备输入

- `run/spatial-evaluation-inputs/tartanground-moderncity-p0006-v1`：每2s＋末帧，77观察/231图，3×72维RGB描述符绑定输入hash；原模型输入不含地图/pose/标签。
- P0001对应`.../tartanground-moderncity-p0001-v2`：58观察/174图。
- 原P0006没有独立语义区域/重访标签。之后新增小题集不意味着原42条语义分组已补标注。

## 当前位姿拓扑侧车

- `datasets/fixed-pose-routes-p0006-v1/{input,gold,frozen}.json`：42条完成输出＋821pose；74条预先确定的程序检查答案。
- `run/fixed-pose-routes-p0006-geometry-v1/`：纯程序回归，不调用模型。
- `run/fixed-pose-routes-p0006-narration-v1/`：真实两次说明、图快照、报告、requests/usage、`language-review.json`。
- 仅完成前缀0–82s；84s失败和后续pending不接入。地点候选继承原固定模型，不当语义真值。

## 旧24题开发集

- 正式冻结：`datasets/tartan-route-qa-p0006-v2/`；v1保留为未冻结设计草稿。
- `public.json`是题目/图库/朝向/拓扑；`gold.json`为答案及私有来源；`frozen.json`绑定hash。
- `questions-and-answers.md`为人工阅读视图（含答案，不能送模型）；`review.jpg`为35张图联系表。
- 24题/6位置锚点/5边；锚点范围2m，其他锚点≥8m，查询与参考相隔0.5s；不是长期重访或语义房间。
- 官方NED quaternion逐相机算yaw，量化15°；检查全部1504组left/front≈−90°、right/front≈+90°。旧24题向模型提供了朝向，新地点识别方案不提供pose。

## 其他已知样本【历史/非主线】

- UTE P01/P04：原片完整解码并审阅109张分布帧；保留原片和H.264浏览器副本。见`docs/research/ute-p01-p04-review.md`。
- EgoLife：两段20分钟工程样本；不能称已完成全天或长期生活评测。
- 自建低细节Three.js校园被否定，不作为主数据，原文件/历史路径保留。
- ReplicaCAD为渲染/工程试验，不当大型校园基准。
- ModularNeighborhoodIntExt部分住宅轨迹只见街道/庭院/门廊，未确认室内；现成大型场景、全天室内外样本仍未解决，不能默认为已取得。

本页给本机路径，不承诺数据随代码提交或另一台机器可直接访问。迁移时必须检查工件、许可、hash及容量。
