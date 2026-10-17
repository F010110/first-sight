# 时间辅助文本索引与公开任务协议

## 已实现，不冒称论文复现

`sim/temporal_text_index.py`提供本地FTS5词法分支，参考EgoRAG的带时间文本→原图复核、Video-RAG的辅助文本→视觉证据分工。不是官方CLIP/Chroma召回、层级摘要或完整Video-RAG；没有同预算QA效果成绩。相对录制时钟的day/hour只是桶，不是跨日能力证明。

输入JSONL字段严格为`id, observationId, channel, text, producer, sourceImageSha256`。文字必须来自实际已存在的caption/OCR/检测结果，记录生产者及原图hash；索引不生成文字，不将预测当真值。当前RGB档案无法认证音频，因此拒绝ASR输入，而不是伪造转写。文档上限10000、输入16MiB、每段4000字符、查询512字符/16词/24结果。按录制与严格历史截止过滤；无结果保持unknown。

用法：`python sim/temporal_text_index.py build ARCHIVE DOCUMENTS.jsonl NEW-INDEX`。模拟器同时配置可信环境变量`SPATIAL_EVIDENCE_ARCHIVE=ARCHIVE`和`SPATIAL_AUXILIARY_TEXT_INDEX=NEW-INDEX`。

索引manifest绑定archive数据库与索引文件hash，构造时核验；不改冻结v1/默认原图分页。RequestAgent继续使用同一search/inspect接口：命中文本不算已读图片，仍须inspect原图后才允许引用；不赋placeId。真实学校尚无经过核实的OCR/ASR产物，本轮不凭人工编造文本刷成绩。

## MeMoREval公开协议

`sim/memoreval_protocol.py`实际处理官方revision `698894e0f9d0a0d802a607a9624048aa4841ff36`下57个任务/183个请求，输出`run/memoreval-protocol-v1`。每个请求独立fresh context；仅白名单instruction/question/allowed_skills/max_steps进入请求。reference_answer、success、reference_plan及experience技能调用保存在evaluation-only。Experience调用只给模拟器控制器，不能作为记忆观察泄漏物体位置。

这只是公开任务协议适配；没有官方完整模拟器、预测物体图、正式评分或模型效果结果。

## 本轮验证

- TS构建通过，空间相关20测试通过，含辅助检索录制/截止隔离、未知、inspect/citation、重启、索引篡改拒绝。
- 新增Python时间文本索引测试通过：来源hash、缺失音频拒绝、历史/录制过滤及重开查询。
- 新增Python MeMo协议测试通过：答案、目标实例、参考动作不进入请求。
- 0云端模型调用，不运行未获准长测。

EgoMonth曾尝试的HF路径返回401；单凭401无法区分私有/受限资源和错误路径，不能宣称已确认必须身份认证。需先核对官方入口；若真实入口要求身份或同意条款，再交用户办理。
