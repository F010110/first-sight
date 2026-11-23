# P0006三摄回放及固定方法2准备

目标：ModernCityDowntown/Data_omni/P0006，沿用HF revision `388faf9c800568cfc6828fa47e063f8369397eb3`。1504组、10Hz、首末帧跨度150.3秒；三路ZIP合计2216507068字节。原始元数据平均速度约1.543米/秒，仍是机器人轨迹，不当作视障真人步行。

## 采集与发布门

使用`scripts/datasets/collect-tartanground-replay.py`，指定P0006及其pinned metadata，下载预算显式2304MiB。单路有界重试、保留partial；全包SHA256、每张PNG CRC/解码、三方向源索引对齐、各路H.264视频完整解码/帧数通过后才写就绪manifest。失败不出现在可用列表。源PNG保持不变，MP4为网页兼容显示副本，无插帧、改时钟或拼接。

目标原始归档：`datasets/tartanground-moderncity-P0006-complete-v1/`。
目标网页包：`run/replicacad-pilot/tartanground-moderncity-p0006-v1/public/`。
网页沿用8884的`/recordings.html?source=simulation`，同一选择器、前大侧小，不新增入口。不覆盖P0001，不改冻结v2.1.0标签。

## 现有系统的输入准备（不启动模型）

```powershell
.venv/Scripts/python.exe scripts/datasets/prepare-tartanground-spatial-input.py --archive run/replicacad-pilot/tartanground-moderncity-p0006-v1 --output run/spatial-evaluation-inputs/tartanground-moderncity-p0006-v1
.venv/Scripts/python.exe scripts/spatial/prepare-spatial-candidate-features.py run/spatial-evaluation-inputs/tartanground-moderncity-p0006-v1/public.json run/spatial-evaluation-inputs/tartanground-moderncity-p0006-v1/features.rgb-v1.json
```

每2秒原始帧（0、20、40...1500）及末帧1503，共77组、231张原PNG；最后间隔0.3秒，明确保留，不拉长到2秒。public.json只含schema/observations，每行只含匿名id/scene、原始atMs和front/left/right原图路径/哈希；地图、位姿、场所标签、答案、未来证据均排除。descriptor只从这些RGB提取，与public输入SHA256绑定。

## 后续实际运行需单独确认

固定入口是`scripts/evaluation/run-spatial-method2.mjs`（**三视图离线方法2**），不是网页当前单前摄RealtimeMethod2直接喂三张图。保持ground-first、比较消歧、连续区域粒度、短引用、最近2+视觉2、sequence6及原预算保护，不修改算法或启用graph。

```powershell
node scripts/evaluation/run-spatial-method2.mjs run/spatial-evaluation-inputs/tartanground-moderncity-p0006-v1/public.json run/spatial-evaluation-inputs/tartanground-moderncity-p0006-v1/features.rgb-v1.json --confirm-paid
```

此命令有付费调用，本轮只准备，**不执行**。原入口最多256次调用、估算USD0.50上限；不保证77组一定可在保护上限内全部完成，触限/失败保留并停止，不自动续跑或拼接成功前缀。没有独立审核标签，不报告空间准确率或用模型预测回填真值。

当前文档描述采集及准备方案，不等于完成；以完整采集receipt、就绪manifest、输入preparation.json及后续网页验收为准。

## 完成核验

P0006三路完整下载及校验完成：1504组、4512张PNG；三路H.264视频均生成并完整解码核验通过。就绪manifest已发布。实际Chrome在用户现有8884服务中验证三图加载、90秒定位、继续播放及150.3秒末帧，前宽780/侧宽260，无页面异常，未重启服务。

已执行输入准备及原RGB descriptor提取：77组/231张原图哈希通过，3视图×72维特征，特征inputSha256与public绑定，末帧原时钟150300ms。`preparation.json`记录preflightPassed=true、modelCalls=0、paidRunStarted=false、awaitingPaidConfirmation=true。原算法未修改，没有运行模型，没有空间准确率结果。

## 用户后续授权实际运行

用户随后明确要求启动并评分，已通过`scripts/evaluation/run-tartanground-method2-and-score.mjs`启动**一次**原固定method2；本节覆盖上文“只准备、不执行”的当前状态，preparation.json保留为准备阶段收据不篡改。批次`run/spatial-single-batches/tartanground-p0006-method2-20261027-v1`，推理目录`run/spatial-fixed-evaluation/2026-10-27T08-05-17-425Z-054f3ec0`。预算和输入不变，不改方法2代码，不自动续跑。

结束后用旧`score-spatial-repeat-batch.mjs`只读统计此单轮的完成/失败/pending、unknown/覆盖、组数和调用费用；不将一轮当三重复或三方法比较。独立标签仍未具备，`accuracy-status.json`须明确准确率、错合并/拆分、重访准确率为null；原acceptance评分器保留，待合法、审核并绑定public SHA的标签后才可使用。不生成伪标签或搬用旧学校真值。
