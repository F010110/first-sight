# 小样本冻结与旧地点视觉召回 v2（开发层）

## 先确定样本

### 采样纠正（用户确认）

原HSSD脚本24Hz动作流每12tick保存三摄（2fps），每4个保存帧创建一次window，因此观察流约2秒一组。这轮10秒/19观察只是临时token校准，不是替换该采集规划。现已另建`run/tartanground-school-fixed2s-v1`：0,2,...,176秒共89组三摄，另保留177.5秒末帧，共90组/270图。原19观察/8观察结果不覆盖，不将旧token或准确率结果算作90组测试结果。pack脚本默认改为2秒，复现旧子集需要显式`--interval 10`。

正确目标链路：2秒观察→本地质量/视觉变化与累计新信息门控→有界候选/原图上下文→VLM按观察分类→持久地点/访问/证据。**当前门控仍未接入**，v1是时间/批量调度，v2视觉特征是旧地点候选检索，不是调用门控。固定最多4观察合批只是离线校准设置；90组无门控全量离线约23个窗口，不代表在线动态调用数。门控应保留首帧、累计慢走变化、转头补视角、遮挡不确定和静止环境变化巡检，不依赖IMU积分位移；何时触发和每次送哪些关键帧需另测漏检/延迟/成本。

使用已渲染TartanGround，不重新渲染、不拼接/复制成一天。

- 场景：AbandonedSchool / Data_omni / P0000。
- 源HF revision：`388faf9c800568cfc6828fa47e063f8369397eb3`，原包与hash：`D:\Datasets\TartanGround\pilot-v1\verified.json`。
- 小规模开发全集：`run/tartanground-school-fixed10s-v1`，177.5秒/209.96米，19组三摄（10秒采样+末帧）。画面包含外墙通道、围栏球场/庭院、进入室内走廊及大厅。
- 固定付费校准子集：源帧0、100、300、400、1000、1100、1200、1300；数据`run/tartanground-school-calibration-input-v1`。分两窗各4观察；与v1采用完全相同输入。
- 评测私有：原始位姿、路径长度、几何代理重访对，位于evaluation-only。300→1100相隔80秒、相距0.91米；它不是房间真值。模型只读RGB/观察ID/相对时间，检索不读位姿。
- 社区P0000作为室外候补，不计入本次同一校园/同一记忆库，且53.5秒抽样主要室外，不拿环境名字宣称此路线入室。

这个样本已用于开发选择，不能再当未见测试集。后续需要独立路线、相似区域正负例和更多旧地点，不能只用这一个重访对挑参数。

## 实现

新文件`src/agent/spatial-visual-recall.ts`、`src/agent/spatial-v2-service.ts`，本地Pillow特征提取`sim/spatial_visual_features.py`。冻结v1源不改，默认生产API/模拟器UI仍使用原v1；当前显式通过校准配置visualRecall启用v2。

1. 每张图提取4×4 RGB布局与分通道8桶直方图，共72维。每观察1–4张图；当前样本3图。三摄集合用对称最近视图距离，减轻方向顺序差异，但不是旋转不变保证、不是语义embedding、也不估算位移。
2. 特征放每库独立SQLite sidecar，以原观察ID索引；记录特征版本并绑定拓扑库路径，禁止相同sidecar跨库复用。启动可分页回填，零VLM调用；每批最多100观察，提取有超时和输出预算。
3. 查询只匹配已分配观察，时间严格早于当前窗口最早时刻，排除当前观察和退休地点。实时JOIN最新assignment，merge/split/undo不靠旧place标签缓存。历史时间过滤使用原observations的at_ms，身份沿用当前修订，不是历史数据库重建。
4. 扫描特征时只保留2个最佳地点，每地点保留最相似原观察。**当前磁盘扫描O(N)**，只保证流式读取和有界候选，不宣称百万规模低延迟或ANN索引。
5. 一条近期候选+两条视觉候选，去重后最多3地点；原观察作为比较参考，避免历史点虽被召回却因原v1“只展示最新3节点原图”的规则再次丢失。对比不是同候选预算消融：v1目录最多6，v2当前最多3全图候选。后续需要单独校准预算。
6. VLM仍读原图，决定已有ID／new-N／unknown；相似度不能直接确认地点。命中观察只作为临时上下文，不覆盖库的首末代表；提交仍用原SQLite原子事务。索引在commit前写入，未分配条目不会被查询JOIN看见；重启回填可恢复。
7. 新开发service保留4观察窗口、显式flush、单在途、pending、UUID身份、merge/split/undo。特征失败停止并保留pending，不静默冒充已识别。尚未接入UI或RequestAgent的通用检索工具，后者仍使用现有独立Scoped Retriever。

## 验证结果

- `spatial-visual-recall.test.ts`：10地点夹具（特征为可控测试向量），最早地点已退出v1近期6节点，v2召回并在service提交旧ID；覆盖严格时间截止、sidecar跨库拒绝、merge后映射、undo、重启。此项证明流程正确，不证明真实视觉能力。
- 真实RGB离线检索：排除查询前30秒帧，80秒代理重访帧300在8个早期候选中排第1。报告`run/tartanground-school-visual-recall-eval-v1.json`。1个代理正例，不能报告泛化Recall@K。
- 同8观察真实v2付费运行：`run/tartanground-school-real-calibration-v2`，2调用、输入12838token、输出1071token、0修复、8观察/3地点、pending0。80秒重访仍归到同一ID；第二窗召回实际帧300和0，不靠评价位姿。两请求约11.003s和8.590s（不含完整外部特征进程开销）。
- v1同子集为输入12850/输出1133token；本例没有证明v2优于v1，因为仅3个地点、旧地点并未退出近期候选。真实远期召回增益尚待多地点多会话评测。

## 运行

`spatial-calibration.ts`配置增加：
```json
{"tokenCalibrationOnly":true,"maxWindows":2,"maxObservations":8,
 "visualRecall":{"command":"PYTHON_EXECUTABLE","args":["sim/spatial_visual_features.py"]}}
```
本机Windows使用wsl命令调用已有EAM venv Python；特征脚本将输入D盘路径映射为/mnt/d，不要求新装系统Pillow。新结果目录调用原校准入口，保留recall-trace.jsonl。大样本需要实际金额配置，不能用token-only模式绕过长期预算。

## 仍需完成

下一步选独立学校轨迹，先读metadata检查路径重叠和室内外覆盖，再下载必要图像；冻结开发／验证分割。增加至少7个有效不同地点后的重访，以及反向视角、相似但不同教室等负例。根据实测决定改用本地学习型视觉检索或更强多阶段候选，不能将粗颜色布局检索宣传为通用旧地点召回。运动门控、8小时测试仍未启动，真实单价尚未核对。
