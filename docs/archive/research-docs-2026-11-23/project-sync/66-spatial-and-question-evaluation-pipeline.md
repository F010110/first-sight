# 空间记忆 + 用户问题多维评测流水线

## 实现和边界

入口：`npm run eval:memory -- all PLAN NEW-OUTPUT --confirm-paid`。

流水线为：冻结公开输入/前缀/私有评分规范 → 按时间生成空间记忆 → 原图独立请求评分 + 机械轨迹审计 → 空间门槛 → 原有冻结问题独立答题与评分 → 多维JSON/Markdown报告。

没有单一平均总分。所有比例携带numerator/denominator，未测维度为null。失败、未运行、评分协议失败都保留；维度评分缺失时在计划分母中保守计零，同时单独报告评分覆盖率，不冒充真实零分。原始请求、使用量、失败、初版评分都保留。输出目录和评分版本必须新建，不自动覆盖重试。

### 空间维度

- 完成率、评分覆盖率。
- grounding：图像事实可靠性；coverage：关键可见内容覆盖。
- direction：摄像头来源绑定；temporal：是否把旧画面写入本轮描述。
- associationSupport、calibration：关系证据强度和置信度适当性。
- positiveRevisitRecall：预先冻结的重访来源被实际解释找回的比例；不能由一般同楼猜测替代。
- positiveTargetDelivered / ReadViaTool：目标是否进入模型输入、是否真正通过工具读回。与语义支持分开，不拿引用存在当正确。
- 完整性：原图hash、检查点hash、来源/时间约束、独立视觉输入隔离、固定观察是否被改写。机械检查只覆盖已实现项目，不宣称全系统安全证明。

0—4评分归一化到100是有序开发评分，不是逐条事实正确率。同家族Qwen独立请求评审，尚非人工盲审金标准。

### 问题维度

计划可选`questions`：`tasksPath/tasksSHA256`、`referencesPath/referencesSHA256`、`taskIds`。任务必须来自冻结的公开题库，题目不改写，且queryAtMs/currentObservationId精确绑定本次生成的检查点。私有expected只进评分请求；各独立评测题使用独立私有会话，空间源数据不接收答题结果。

空间门槛通过后才运行，输出完成率、评分覆盖、utility、安全事件、时间隔离、引用检索支持；适配器仅允许≤15题开发试验，拒绝直接扩大90题。原有15题/37分支门槛仍标为未运行，不以这套小样本替代。此中等运行未配置新的题目，也未进行真实问题评分。问题适配器的通过/阻塞、私有参考隔离和未来隔离已用本地端到端mock测试覆盖。

### 开发路由门槛v1（不是生产验收）

至少6个新观察、1个正重访、1个非正例不确定关系；所有生成和评分完整、零完整性违规、零无依据身份扩展。grounding≥90，coverage≥85，direction/temporal≥95，associationSupport/calibration/positiveRevisitRecall≥90。门槛写在`spatial-scorecard.ts`，不能看到本轮结果后放宽。覆盖仅够路由实验，不能表示统计充足或生产可用。

## 小规模迭代如何保留长期状态

两种模式：

1. `fresh-sequence`：同一session按计划时间顺序执行。只有计划覆盖公开输入的全部行，才标`fullContinuousMemory=true`；稀疏样本不当作完整路线。
2. `source-state-replay`：从已冻结来源账本导入整个选定前缀的canonical sources，不是只复制最近4条；完整归档仍可召回。随后用原图重新执行短后缀。前缀检查点、上下文和图像均校验hash；只接受有明确canonical sources的账本。旧解释不作为事实导入。

真实全量应一次连续生成，之后可选不同截止点导出前缀，以几十次调用测试新后缀。前缀保持不变才能公平比较候选；更改视觉提取、压缩、前缀行为后，小测只能证明局部能力，最终仍需完整连续运行。当前恢复的是来源数据面，Pi执行历史/压缩状态从新会话开始，**不是严格等价的会话恢复，也不能作为完整路线质量分数**。

本次使用稀疏开发前缀，不假装拥有已经合格的完整记忆。重复性和更多留出重访仍待验证。

## 已完成的中等规模运行

计划：`evaluation/spatial/medium-v1/plan.json`。
结果：`run/unioncity-spatial-pipeline-medium-v1/`。

- 冻结71/90两个前缀来源；从原图重新生成163/164、179/180、249/250、385、792/793/794，共10个新时刻、30张新原图。
- 45次生成调用 + 12次首轮评分 = 57次。随后只对固定预测重评12次，总计69次；没有再生成记忆。
- 首轮评分保留`scorecard.json`及`review/`：179使用了schema外的issue类别`grounding`而未获有效评分（当时校验器的通用错误消息误指向引用问题；回看原始响应后已修正诊断消息）；249/180等存在把图内左右混同摄像头方向的评分错误。首轮不是可信的方向质量基准。
- v2仅澄清摄像头/图内坐标及逐字引用要求，全部预测不变；保留`scorecard-v2.json/.md`及`review-v2/`。这属于评分器校准，不是模型提升。两个版本不能当作候选架构优劣对比。

| 维度 | v2开发分数 | 分母/解释 |
|---|---:|---|
| 生成完成 | 100 | 10/10 |
| 评分覆盖 | 100 | 10/10 |
| 图像事实可靠性 | 82.5 | 33/40评分点 |
| 内容覆盖 | 100 | 40/40评分点 |
| 摄像头方向绑定 | 100 | 40/40评分点 |
| 旧状态残留控制 | 100 | 40/40评分点 |
| 关联证据支持 | 100 | 8/8评分点，仅2例 |
| 置信度校准 | 87.5 | 7/8评分点，仅2例 |
| 正重访找回 | 100 | **仅1/1，不代表稳定召回率** |

65项机械检查无违规。793本轮主要关联前一秒的792，没再猜地面餐厅同楼；因此不应把它夸大为困难远距离关联成功。385读回71并引用，但关于90“视觉连续性”的补充仍弱。细节问题包括吊灯点亮却说未亮、门外红物体被猜作遮阳篷、设备类别等。评审对灰/黑颜色、可见程度也有波动，仍需少量人工校准，不能照单全收。

**开发门槛未通过**：grounding82.5和calibration87.5低于冻结门槛，问题评测阻塞，未启动90题或813帧全量。上一轮probe-v3漏掉71的失败继续保留，本轮1/1不能抹去不稳定性。

## 命令

```powershell
# 新候选一次跑生成、评分、门控，按门槛决定是否答题
npm run eval:memory -- all evaluation/spatial/medium-v1/plan.json run/NEW-CANDIDATE --confirm-paid

# 分阶段；score默认使用校准后的v2评分规范
npm run eval:memory -- run evaluation/spatial/medium-v1/plan.json run/NEW-CANDIDATE --confirm-paid
npm run eval:memory -- score run/NEW-CANDIDATE --confirm-paid

# 原预测重评：必须新版本，保留所有旧评分
npm run eval:memory -- rescore run/NEW-CANDIDATE v3 --confirm-paid

# 仅空间门槛通过且已配置原有冻结题目时可运行
npm run eval:memory -- questions run/NEW-CANDIDATE v2 --confirm-paid
```

核心文件：`spatial-evaluation-pipeline.ts`、`spatial-scorecard.ts`、`spatial-pipeline-questions.ts`，位于`src/sim/evaluation/`。

本轮完整本地测试501/501通过；这不替代上面的语义评分。未切换默认服务，未提交或推送。
