# 成熟算法接入执行记录

## R1：原图存档和RequestAgent（2026-10-17）

- `sim/spatial_evidence_archive.py`从原始images包构建独立档案，复制原始字节、验证源sha256；只保留id/session/time/cameras/hash。输出失败保留目录，但没有complete.json时禁止查询。
- `src/agent/spatial-evidence-retrieve.ts`实现RequestAgent所需search/inspect/citation接口，不依赖地点归属；严格recording＋历史截止，最多12次search及8图默认预算；有界分页、路径realpath校验、图片hash复核。
- `RequestAgent`改为使用最小公共证据接口，旧topology检索保持兼容；独立mock流式测试实际经过search→inspect→answer三请求，archive分支可引用无地点身份的原图。
- 模拟器设置可信环境变量`SPATIAL_EVIDENCE_ARCHIVE=档案绝对路径`后，retrieve/request走档案分支，其他地点/修订/变化操作仍走原topology。默认不变，无产品前端改动。不通过浏览器参数选择文件系统路径。
- 档案尚无语义embedding索引；带关键词/地点约束返回unknown并说明可按时间翻页，不假装能搜索事件。R2/R7才增加相应检索。此功能不等于长期QA准确率通过。
- 学校真实90组/270图存档，TS检索取回全部90组并inspect门控跳过帧`AbandonedSchool-P0000-000040`三图，placeId=null；结果`run/tartanground-school-evidence-archive-v1/retrieval-acceptance.json`，0真实模型调用。
- Python档案2测试通过；空间TS回归18测试通过（包含topology和archive的RequestAgent流式mock、signed cosine检索测试）。

## R2：SALAD（进行中）

- 官方源码位于`D:\Datasets\research-code\salad`，revision `6aede13a3f6c25750bf7fde10209c06cb73060bb`；LICENSE为GPLv3。保持外部隔离研究运行，不复制上游实现进本仓库；分发/产品集成需单独审查条款，不默认独立进程消除许可义务。
- `sim/salad_features.py`为官方模型本地推理适配，严格指定本地SALAD/DINOv2源码和权重sha256，不允许隐式Hub下载；输出8448维归一化描述子。尚需实际运行验证，不能以脚本存在宣称模型接入成功。
- `spatial-visual-recall.ts`支持可选版本/维度/余弦距离，默认RGB不变；sidecar绑定描述子规格拒绝不同模型覆盖；仍是O(N)历史扫描而非ANN。
- 隔离WSL CPU环境`/mnt/d/Datasets/research-code/venv-visual-memory`安装依赖，不改已有EAM venv或全局Python。官方335.7MiB检查点已下载；哈希及实跑记录待补。
- `sim/evaluate_learned_recall.py`在独立评测端读取几何代理对，模型提取端不读GT；支持与原RGB距离同候选时间排除规则对照。不将几何代理排名称房间身份准确率。
- 检查点352040378字节，SHA256 `6b3f1720954293e83da6966c5cfcfc6713200d7fefadcca76fc51aeb80b3cada`；DINOv2 revision `7764ea0f912e53c92e82eb78a2a1631e92725fc8`。锁文件`D:\Datasets\research-code\salad-lock.json`；推理直接调用官方backbone/aggregator，不加载Lightning训练依赖，严格加载全部权重。
- 第一轮真实提取`run/tartanground-school-salad-v1`在导入torch失败：隔离环境安装尚未完成，保留失败目录，不覆盖。没有SALAD结果，更没有改善结论。安装完成后必须新目录重试。
- RGB同90组离线对照已运行：精确历史观察端点排名14代理对，top1/top2各3/14；不是地点Recall@K，因为同地点相邻帧可能排在指定端点之前。评测脚本新增明确rankingTarget和因果/字段完整性/拒绝覆盖回归测试，WSL通过1项。
- 新增`sim/cached_visual_features.py`，将完成的学习特征导入只读SQLite缓存；查询逐ID验证当前图像字节hash，防止同ID错图复用。离线未出现的观察明确拒绝，不伪造在线推理。缓存协议1项测试通过；可通过校准config.visualRecall.command/args及descriptor/maxOutputBytes启用，无需每次query重复加载模型。尚未用真实SALAD特征完成该链路。
