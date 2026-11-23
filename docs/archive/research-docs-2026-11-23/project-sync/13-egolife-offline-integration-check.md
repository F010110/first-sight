# EgoLife离线评测接入：续查结果与更正

本次是在[11号交接任务](11-lightmem-first-sight-comparison-task-handoff.md)三天时间盒内续查；不是新科研/产品功能。不覆盖[12号阶段报告](12-lightmem-first-sight-comparison-results.md)，其“未做配对QA”仍为当时事实，但**不能再将它理解为没有公开题库或没有可用离线复现路线**。

## 1. 结论

**First-Sight可以接同一EgoLifeQA题目和评分协议；本次已实现隔离的协议适配层，验证500道官方题的格式/评分合同。尚未跑通500题记忆推理，也没有新的方法准确率。**

LightMem-Ego仓库确有两套独立公开脚本：EgoLife和Video-MME。它们是EM²Mem离线评测，不要求先部署完整在线web/眼镜后端。Ego-R1虽在结果表中，但本固定快照未找到第三套独立对应入口，不能仅按三栏成绩假定三套均完整发布。

脚本公开使“有明确复现路径”成立，不自动保证原样安装/数据齐备/模型相同。继续使用Qwen API会是明确记录适配的对照，不是GPT-5原报告绝对成绩复现。

## 2. 新发现：本机已有官方题，官方也提供记忆工件

### 本机官方QA

`datasets/realism-source-survey-20261024-v2/EgoLife/EgoLifeQA/EgoLifeQA_A1_JAKE.json`：

- **500道题及标准答案**，SHA256 `688ae079f458132f13150711b7e099fbe4fdedd97f19f5a33bdebb7bfde74a52`。
- EntityLog125、RelationMap125、EventRecall126、TaskMaster63、HabitInsight61；跨DAY1–DAY7。
- 102题标为不需要音频且不需要人名。但这不等于现有视频已包含这些题的历史证据。
- 原始字段包括question、choice_a..d、answer、query_time、target_time、reason、keywords等。答案/目标时段/理由只供评分，不进模型。

### 现有视频覆盖（本次按源文件名时钟审计，不猜测）

现存80个30秒片段，共两段20分钟：

- DAY1 11:10–11:30；
- DAY2 10:44:30–11:04:30。

只有4题发问时刻位于这些片段中；只有1题同时覆盖官方标注的目标证据，且该题需要人名。其余3题的目标是未保存的DAY1更早/更晚时间，而非当前DAY2窗口。

所以当前“视觉且不需要名字、query与标注target都覆盖”的先导候选为0。**这是现有视频覆盖不足，不是题库缺失，也不是任何模型得0分。**标注target覆盖本身仍不保证完整历史充分性，不能只下载答案附近片段就称公平长期记忆测试。

### 官方复现工件已确认可访问

来自固定仓库`research/em2mem/README.md`给出的Google Drive根目录，不是广泛搜索：

- 根目录包含`metadata/`及两个结果文件。结果文件不下载/不作为运行输入。
- metadata中有`multimodal_memory_cell/A1_JAKE`、`semantic_graph/A1_JAKE`。
- 确认有`A1_JAKE_record.json`、多尺度/episodic sidecar目录、`semantic_graph_gpt-5-mini.json`等。
- 对record文件只取**128KiB Range前缀**，HTTP206，Content-Range确认整文件39,037,176字节；没有全量下载。
- 首条record含date/start_time/end_time、caption_text、transcript_text、fine_caption、scene、visual_objects、speakers、keyframe_paths等；不是只有论文结果表。

这意味着可以先核验官方记忆工件，避免盲目下载整套视频和重新生成全部caption。但这些是上游生成的记忆：**不能只给LightMem语义工件，让First-Sight从零RGB建忆，再称信息相同；也不能直接把这些工件塞给First-Sight后声称其原生建忆通过。**

## 3. 接口如何对齐

官方`eval/eval.py`调用：

```python
qa_result = em2mem.answer(query=question, choices=choices, until_time=query_time)
response = qa_result.answer
```

First-Sight不必成为LightMem的内部模块；应是同一外层评测器下的另一回答方法。保留各自记忆实现，统一question/choices/截止时刻及评分。

新增`src/evaluation/egolife-first-sight-adapter.ts`：

1. 从官方row仅提取公开题目、选项、query_time，去除gold/target/reason/keywords/trigger。
2. 区分EgoLife `DAY+HHMMSSff`整数与SQLite使用的毫秒时间轴；centisecond不丢失。
3. 接收由同前缀原图建立的因果快照，检查不能包含未来原图/晚于问题的判断。
4. 注入**固定版本的原生`answerRealtimeQuestion`函数**，调用其原有search/inspect/answer流程；不导入LightMem记忆代替First-Sight。
5. 将有效选项字母或完全相同的选项文本转成官方response，保留原答案、拒答与错误状态。

这只完成“题目→原生问答→评分输出”的适配接口。**还缺将足量EgoLife历史按同权限建忆/回放的整套驱动；没有在官方eval.py内实际跑完First-Sight，也不宣称接上接口等于语义评测通过。**

## 4. 官方评分器的一个实际坑

本次从固定commit的`eval/eval.py`只提取3个已审阅纯评分函数运行，不导入重模型。其首字母正则比较宽松：字符串`Abstained`会被当成A。

因此适配器对拒答使用官方失败哨兵`Error`，另存status=`abstained`；不把“拒答”伪装成A获取分数。运行失败、拒答、数据不兼容也分别记录。

协议自测验证：500个正确字母都能被官方helper识别；`Error`不会被计正确。**这是gold驱动评分器合同测试，不是500题模型满分。**没有依据这些结果改官方答案/评分函数。

## 5. 原样执行脚本前必须处理的具体问题

|问题|固定源码事实|处理边界|
|---|---|---|
|全量下载|`script/1_setup.sh`会`uv sync`并下载整个EgoLife数据集|不能直接盲跑；只取确定需要的工件/片段，明确体积|
|打包路径|pyproject引用本地`src/HippoRAG`、`src/EgoRAG`，本固定Git树未包含这些目录|完整uv安装有明确缺口；先判断当前执行路径是否实际需要，不能随意混入online源码或假包|
|环境/GPU|Python>=3.10；torch2.7.1、flash-attn、GPU faiss等依赖，默认text embedding需要真实模型|优先隔离最小环境，不污染已有research；不自动下载大权重|
|Qwen路由|离线LLMModel按`qwen3`名字转本地Qwen3VL；本地wrapper只支持指定2B/4B/8B别名|直接写`qwen3.8-flash`不会变成Qwen API调用，需显式API适配|
|API格式|离线OpenAI wrapper限定GPT模型映射，使用Responses API的create/parse；本项目已有验证是Chat Completions|不是只填base_url就能解决；需显式桥接请求、结构化返回、错误及usage，不能伪称模型未变|
|字幕/caption预处理|generate_sync默认DenseCaption目录为空，可退为transcript-only|必须记录实际输入轨，不把文字-only当完整视觉复现|
|视觉特征|eval允许无visual_embeddings.pkl而继续keyframe-only|可选视觉embedding不是启动必要条件，但文本embedding不能因此假装mock已充分|
|时序权限|使用until_time；预生成semantic摘要也需查是否含未来事实|不能仅按记录start_time截断，就允许跨未来生成内容进入过去问题|

这些是明确的输入/配置/依赖适配项，不是“现成方法理论上不能做”。也不意味着必须重构First-Sight。

## 6. 已验证与尚未验证

已执行：官方源码检查、Google Drive目录与record小前缀读取、500题schema/源时间/本地片段覆盖审计、官方评分helper合同测试、TypeScript接入层5项测试。

另有Python时钟/覆盖/隐私字段5项测试通过，构建通过。均为工程协议验证，不当用户题准确率。

未执行：安装离线完整依赖、下载embedding权重、完整下载工件/视频、EM²Mem真实检索/答案生成、First-Sight原生EgoLife建忆、真实Qwen调用、官方500题或配对准确率。

新工件目录：`run/lightmem-first-sight-comparison/egolife-offline-interface-v1/`。其中`protocol-audit/{public-tasks.json,gold.json,frozen.json,coverage.json,summary.json}`分离问题和答案；Google目录与128KiB范围请求有收据，未下载结果答案文件。

## 7. 下一步的可执行路径

1. **先跑参考方法的最小离线路径**：明确选择官方已生成工件还是从原视频重建，核验所需文件/许可/总量；采用现成工件时不把原构建费用记为零。
2. 在独立环境处理实际用到的依赖，做受限Qwen API桥接；保留源commit、改动差异、调用与预算。不能用mock embedding替代真实检索后报告准确率。
3. 冻结少量官方题，完整保留其共同历史前缀。不给运行时target_time/reason，不按未来题先筛证据。
4. 接入First-Sight相同输入轨：原生RGB对照不让对方独享现成caption/转录；共同文本/元数据轨需另列“适配对照”，不能当v2.1.0原生能力。
5. 使用现成官方标准答案评分，记录所有开始的题/拒答/协议与环境失败；只跑几题就明确先导，不称复现论文全量成绩。

**回答“能不能”：协议上能接，公开数据/答案/复现工件也已经找到；本次不再以没有benchmark为由停止。完整模型运行仍须上述实际依赖、API适配和共同信息轨落地，不能把这次接口自测写成EgoLife已跑通。**

可避免大权重下载的一条待验证适配路径：已有`research/reports/api-model-probe.json`的模型列表含`qwen3.7-text-embedding`等文本embedding模型。该列表只是服务声明，不证明embedding调用已成功；应在明确预算下做小探针，再决定是否用于API-only运行。换用它不同于原默认Qwen3-Embedding-4B，必须标记适配，不能当相同模型的论文复现。
