# 固定分组验收流水线 v1

当前正式标准已更新为`docs/research/temporal-image-classification-standard.md`：单一人工区域标签，同区域允许分多组，最终分组与新图旧/新归类分开评分。本文件旧same/different合同保留为历史诊断；新正式包使用`temporal-image-benchmark-v1`。

算法冻结提交：`da10721`。此后只修改评测代码，不继续调算法。

## 唯一入口与结论

```powershell
python sim/run_grouping_acceptance.py benchmark.json baseline-adapter.json candidate-adapter.json NEW-output
python sim/test_grouping_benchmark.py
```

输出 `review/report.md`（用户结论）、`comparison.json`（完整指标及失败事件/原图路径）、两个adapter原始输出与日志。报告结论只允许：**通过／不通过／证据不足**。版本比较允许：改善／持平／存在退化；证据不足时不得作为验收结论。诊断方向另列，不混入验收。

## 三项固定能力

|能力|唯一主判据|附带防作弊项|
|---|---|---|
|稳定性|已审关系的错误改绑次数|正常纠错、撤回、已有决定数量；不把节点改名当改绑|
|分组正确性|必须同组恢复率、必须异组分离率，二者均须达标|unknown计未恢复；覆盖、明确异区域误合并单列|
|分组内容识别|固定查询返回至少一个相关历史内容，且不含错误内容的比例|未知计失败；错误返回单列；禁止自己/未来内容|

不合成“总准确率”。每一项都须满足预先冻结门槛，没有靠另一项高分抵消严重误合并。已判关系全部撤回不能保持虚高稳定性。

## 固定真值，不限制一个房间一个组

`benchmark.json`包含：原始图像路径/hash、唯一观察ID与时间、事件级必须same/different关系及原图依据、固定历史查询及候选相关性、独立复核/留出性质、政策阈值。未指定的观察对不评分。允许合理子区域，不把粗roomId自动展开为所有同房间都必须同组。same传递闭包与different矛盾会拒绝评分。

默认政策草案：同组恢复≥80%、异组分离≥95%、内容识别≥80%、观察覆盖≥80%、明确误合并/错误改绑/撤回0；每种关系至少20例，查询至少20例。**这些只是冻结流程的草案，不是经实证批准的产品标准**；`approved=false`必定阻止通过。最终采集/独立审查后批准一次，之后不得看结果改门槛；改动产生新benchmark hash。

同一足迹的连续帧不算大量独立事件，必须在标注阶段选定事件。现有AI开发审查不是独立盲审，不能勾选independent/heldOut。数据不足时明确证据不足，而不是先出“好分数”再解释不可信。

## 算法输出合同

adapter配置：

```json
{
  "workdir": "D:/path/to/clean-version-checkout",
  "algorithmCommit": "FULL_GIT_COMMIT_HASH",
  "evidenceBudget": "FROZEN_INPUT_AND_VISUAL_CACHE_HASH",
  "command": ["node", "adapter.js", "{input}", "{output}"],
  "timeoutSeconds": 1800
}
```

工作目录必须对应指定commit且无tracked修改。adapter只接收时间/图像/hash和无答案的查询任务，不接收same/different、relevant、阈值。输出：

```json
{
  "snapshots": [
    {"observationId":"o1","atMs":1000,"assignments":{"o1":null}},
    {"observationId":"o2","atMs":2000,"assignments":{"o1":"g1","o2":"g1"}}
  ],
  "retrieval": {"query-1":["o1"]}
}
```

每个前缀必须包含全部已到达观察，且不得含未来观察。ID改名允许、丢观察禁止。两个版本须同一benchmark hash和同一证据预算；原图hash改变、时序改变、Oracle替代在线、漏查询全部拒绝。缓存由adapter使用时，必须以实际缓存hash标识证据预算；禁止仅改版本名后重用一个最终预测包假冒算法运行。

adapter需针对冻结版本独立实现/审查；流水线的输出合同不能单独证明adapter内部没有偷看未来。旧版本尚未统一adapter前，不发布release-to-release成绩。现有运行导入只作合同自检，不冒充版本对照。

## 当前实际验证，不虚报旧新比较

`prepare_grouping_diagnostic.py`将现有两套必要事件导入固定合同，逐原图hash冻结，并明确independent=false/heldOut=false/approved=false。两个imported-run来源都是已执行在线prefix；重复评分同一run仅验证“同输入持平”，**不是旧版与新版算法对照**。

```powershell
python sim/prepare_grouping_diagnostic.py val4 run/sim/NEW-diagnostic-val4
python sim/grouping_benchmark.py run/sim/NEW-diagnostic-val4/benchmark.json run/sim/NEW-diagnostic-val4/imported-run.json run/sim/NEW-diagnostic-val4/imported-run.json run/sim/NEW-self-check
```

真实样本已完成上述合同自检；新单测覆盖通过/不通过/证据不足、全unknown/全合并、错误检索、修改真值或门槛、不同预算、未来/缺失/乱序、重复和矛盾标注、节点改名。

## 完成与未完成

完成：固定评分合同、隔离标注输入的双adapter执行器、版本/数据/前缀校验、固定三能力、门槛/数据资格判定、错误原图定位、实际样本合同自检。

未完成：可靠的独立局部足迹/子区域留出真值、足够独立查询、政策批准、历史版本adapter实际对跑与内部时序审查。这些未完成前，当前算法结论是**证据不足，不能宣称通过**。不再发布粗核心全对展开的8.1%作为最终分组正确率，也不把Oracle条件重访作为端到端成绩。
