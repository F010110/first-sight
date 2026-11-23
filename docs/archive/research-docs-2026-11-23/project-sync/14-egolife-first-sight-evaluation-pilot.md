# First-Sight评测优先：官方EgoLifeQA文本条件先导

## 范围与重要限制

暂停LightMem方法对照，使用现成官方问题和标准答案，先建立可运行的评测闭环。

本次先导是 **provided-caption/transcript lexical QA adaptation**：官方caption与转录 → 确定性词法检索 → Qwen回答 → 官方选项精确评分。

**不能将其成绩写成First-Sight原生系统准确率。**它没有使用First-Sight图像建忆、原生search→inspect原图证据链，检索器也是评测适配代码，不是原生记忆引擎。这一分数只作为文本证据轨的问答起点和评测基础设施验证；不是完整产品评测已完成，更不是与LightMem的对照结果。

## 冻结协议

- 官方JAKE 500题中，每类按SHA256(`first-sight-text-pilot-v1:ID`)升序选5题，共25题，不根据正确答案、证据可用性或预测表现挑选。
- 公开题目与私有gold分文件；推理结束后才打开gold评分。
- 仅使用官方事件工件的`caption_text`、`transcript_text`，不提供fine_caption、语义图、理由、keywords、target_time或上游答案。
- 事件的**结束时刻**不得晚于发问；排除跨截止时刻事件。离线caption自身的制作过程并未经过独立无泄漏认证，这是剩余限制。
- 词法TF/IDF排序取32个事件，最多60000字符；使用题目与所有选项的词，不使用gold选项单独检索。
- 必须提供实际交付的证据ID；拒答、错误、不合协议均在25题总分母内。
- 选择题精确字母评分，无额外模型裁判，无重试、无自动修复、无删除失败题。

## 资源与账目

- 官方record下载39,037,176字节，硬上限40MB；不下载视频或权重，不上传私人影像。
- Qwen API最多25次、每次输出768 tokens；总tokens含未确认请求预留最多650000，估计费用上限USD0.15。
- 按已有项目单价估算：输入USD0.1356/M、输出USD0.4584/M；不是账单金额。供应商实际价格与tokenizer仍是外部依赖。
- 每次调用前预留费用和token，网络失败保留预留，不偷偷重试。
- 不改生产推理代码，不触及8884服务或其他研究环境。

## 运行与输出

```powershell
.venv/Scripts/python.exe scripts/evaluation/run-egolife-text-pilot.py freeze --output run/egolife-first-sight-text-pilot-v1
.venv/Scripts/python.exe scripts/evaluation/run-egolife-text-pilot.py run --output run/egolife-first-sight-text-pilot-v1
```

已存在的输出不能覆盖或静默重跑。复跑需指定新目录，并明确它是另一轮。

关键文件：

- `scripts/evaluation/run-egolife-text-pilot.py`
- `tests/python/test_egolife_text_pilot.py`
- `run/egolife-first-sight-text-pilot-v1/{protocol.json,frozen.json,public-tasks.json,gold.json}`
- 每题输入证据、请求、原始响应、失败原因与usage均保留。
- 完成后的`summary.json`给出总准确率、分类计数、拒答/错误计数和估计成本；`scored-results.json`保留逐题评分。

本次新增5项因果时序、字段隔离、重复ID、空历史和长度预算测试通过；连同既有EgoLife协议测试10项通过。测试通过不等于任务准确率。

## 原生系统仍需补的环节

为First-Sight原生RGB轨准备有足量历史的官方问题，冻结原图历史输入，经实际建忆与原图inspect链回答，再接相同评分器。不能用本次文本轨成绩替代这一项。

## 本轮实测结果

25题真实API推理完成：**10/25正确，40%**。17题有效作答（其中10正确、7错误），4题拒答，4题输出协议失败；所有25题均计入分母。

|类别|正确/总数|
|---|---|
|EntityLog|3/5|
|EventRecall|1/5|
|HabitInsight|3/5|
|RelationMap|2/5|
|TaskMaster|1/5|

共25次调用，212671 tokens，按项目记录单价估计USD0.0314648112（非账单）。4个失败题ID为411、423、211、194，原始响应均为`finish_reason=length`、输出768 tokens，导致JSON截断。未对这些题额外重试、修复或重算分母。

推理后再次核验全部冻结输入的SHA256，均一致。样本仅25题、每类5题，不能据此作稳定全量结论。**40%属于上述独立文本适配器的条件问答成绩，不是First-Sight原生记忆系统分数。**本轮没有完成用户要求的原生系统能力验证；完成的是可运行的官方题评分闭环及一个诚实标注的起点。
