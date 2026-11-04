# 整体空间记忆裁判

```powershell
npm run build
node --use-env-proxy dist/current/sim/evaluation/run-holistic-memory-judge.js run/unioncity-memory-quality100-v1 run/gmod-annotated-rerender-v2-final/sample.json run/unioncity-memory-judge100-v1 --confirm-paid
```

- 新输出目录；完整schema-v4窗口库；位置标注sample与旁边public-source必须与生产输入hash、来源ID、原始时钟和300原图绑定。投递/回放时钟不是标注原始时钟。
- 只读SQLite，不导入生产Agent，不重建记忆、不写回评审结论。标注和私有答案仅进入裁判。
- 固定`qwen3.8-max-0902`，启动查模型registry，无Flash/其他版本降级。自有有界JSON工具Agent＋耐久Session日志；不是Pi生产会话，也不是原生provider工具调用。一次一个动作，实际执行overview/inspect/read/trace/finish。
- 2次批量校准（基本视觉、旧理由/整窗过渡）＋最多8次主审核＋最多2次独立source-first复核；整个CLI共享12请求/900000 token预留预算，每个在途/未知请求预留136000。核心主审核单独运行上限10请求/600000 token，独立诊断单独运行2请求/300000 token。不是每窗调用一次API。最多24图/请求（overview最多12派生接触图，inspect最多4组三摄），每次最大8000输出token、240000输入字符。失败不自动重试，不覆盖旧目录；未知计费保留。
- Max单价尚未核实，记录真实provider token和未知请求预留，不虚构美元成本。请求数/字符/token预留是防失控上限，不是模型正确率或发票保证。
- 全部窗口缩略图导航覆盖和原图检查分开记账；必须看全窗概览并检查至少两窗原图才接受最终报告。这是最低机制门禁，不是充分的语义覆盖保证。
- v2补充：程序按重复理由、参考边界与确认归属重叠、现有boundary及改名/稳定窗挑至多5个probes，必须检查两端原图并逐项说明；程序不判这些窗一定有错。
- 独立source-first复核先只交原图记录近地面/占据区域，再交候选与参考，分别检查身份、当前理由、整窗范围。主裁判分数不交给复核者。只选通用风险探针与后继窗，最多3窗，不是全面第二轮评分。两者仍为同一模型家族，分歧不等于人类真值。
- workflow-result.json保留主裁判原分为provisionalScores；独立复核发现明确矛盾则status=disputed、acceptedScores=null，不平均掉分歧、不偷偷改100分成别的数、不以大量重复调用追求期望分数。人工审核记录单独保存。
- 0–4五维整体有序等级，等权映射0–100；任一维度证据不足则总分null。不是逐帧准确率，不因问题条数较少自动加分。无法验证的历史检索/QA/导航不认证。
- 用户接受本段站内部统一地点；位置标签不强制逐标签拆ID；门口/街边参考边界有范围不确定性。OCR/物体分类暂缓。
- 原始位置标注不对每个物体提供真值；缩略图无法支持细节错误定论；重大视觉指控应查原图。引用被程序约束到实际claim原文、真实参考ID和已交付原图。
- 报告、Session、请求/usage、deliveries和派生图hash全部保留。试评后人工核查裁判有效性；不会因API成功/任意数值门槛自动启动813，也不会自动触发QA。

## 100观察试评状态

- v1：6请求，只有简单视觉校准，25窗概览、4观察原图；主裁判五维100，人工审核不接受其“所有窗口准确”推断。
- v2：9请求，8条正负校准均正确，25窗概览、10观察原图；仍五维100，混淆“身份合理”和“当前理由正确”，把可见地标当占据区域。
- source-first隔离诊断（2请求）：找到v9当前理由有无来源内容、v24整窗范围存疑。原始100分不覆盖，不宣称所有既有人工怀疑都成立；整体状态disputed。
- **grounded v1（现行主流水线）**：9请求/106439输入+10862输出token，25窗3块。先盲看接触图逐窗记录窗头/窗尾占据区域（不给候选、参考、分数），再对照候选与参考逐窗判断identity/currentReason/windowScope，最后综合。结果 **90/100**：location 4、identity 4、organization 4、evidence 2（受v9确证contradiction机械上限）、uncertainty 4；确证1条、存疑2条（v24 windowScope、v8细节）。与人工审核一致地识别出v9无来源描述，且没有把v13/14（本轮理由已更新）误判为错误。
- 校准提示词歧义修复：`supported/contradicted`必须明确是“claim字面主张是否为真”，否则模型会把“指出问题”当作supported（已保留失败运行`run/unioncity-memory-judge100-grounded-v1`）。
- 813：按块扩展（每块12窗，2×块数+4请求上限），付费前用`requireHolisticCapacity`拒绝不可覆盖的预算，不允许只看前缀给整段分数。

## 裁判模型与费用

- 默认`JUDGE_MODEL=qwen3.8-flash`（用户2026-11-04批准的低成本降级）；仍可显式设为`qwen3.8-max-0902`。启动查registry，型号不存在直接失败，不自动降级或换代。
- Flash只能通过`evaluationJsonVlm({allowFlash:true})`启用，policy记录`judgeModel`与`modelPolicy`，因此不会把Flash分数误当Max结果；其他型号一律拒绝。
- Flash按公开列表价估算USD写入usage.json；Max价格未核实，只记token。估算不是发票。
- **降级代价必须与分数一起说明**：Flash的取证与裁决严谨性低于Max；100观察的Max结论（90/100）不自动适用于Flash运行，也不能用Flash结果代替Max复核。


## 813全量

```powershell
node --use-env-proxy dist/current/sim/evaluation/run-spatial-memory.js run/gmod-annotated-rerender-v2-final/public-source.json run/unioncity-memory-full813-v1 --confirm-paid --limit=813 --interval-ms=2000 --busy-policy=queue
node --use-env-proxy dist/current/sim/evaluation/run-grounded-memory-review.js run/unioncity-memory-full813-v1 run/gmod-annotated-rerender-v2-final/sample.json run/unioncity-memory-judge813-grounded-v1 --confirm-paid
```

813为813观察/204窗，分块17块（每块12窗），实际37次请求：2校准+17盲取证+17对照+1综合。跨块时对照请求携带地点/访问表和最多8个已判定更早窗口，帮助判断身份连续性，不携带未来窗口。
