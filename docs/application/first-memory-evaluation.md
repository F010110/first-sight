# 第一次完整记忆开发评测：执行协议

范围：一个学校样本，851组三摄、10段、90题。源辅助AI初标；非独立环境或外部人工真值测试。运行目录`run/school-memory-evaluation-v1`。历史13对诊断不当本轮成绩。

## 顺序与门槛

1. **冻结与建库**：公开问题与私有答案分别hash；217个最多4观察的窗口，episode结束必flush，不跨20分钟关机空档。真实空间v2识别、视觉召回、新/复用身份复核，`qwen3.8-flash`、`enable_thinking:false`、重叠关闭。全部851观察应有提交记录、pending=0。
2. **冒烟**：在预测前固定每个记忆类别首/末有答案题，共6题×3条件=18次问答；必须无执行/schema/usage错误，full-history至少两个实际历史inspect操作；再完成18条盲评判分，才允许全量。
3. **全量**：同一冻结90题×3条件=270次问答；执行器每题新会话，不带前题答案。其后独立进程判分；不完整/重复执行不得生成“完整成绩单”。失败保留并停机，不把其后的题偷偷删除算高分。

## 权限与因果时间

- 当前三向图都输入；不再只给正面图。
- 截止时刻由执行器确定；SEARCH/INSPECT只能访问所允许的原观察，引用必须实际inspect。
- current-only只给当前观察；recent-5min只给最近5分钟；full-history给截止时刻以前记录。
- 联合窗口产生的单帧判断以窗口末帧为可用时间水位。较早的问答不能读到随后同窗图片生成的reason或身份。
- current-only/recent-5min完全隐藏用完整历史生成的reason和placeId，防止旧信息藏在新摘要里。full-history可读已到可用水位的逐观察判断，不读未来可变地点摘要。
- **限制**：recent-5min没有重新训练/生成一套近期语义索引，而是使用严格近期原图与时间索引；full-history还可用因果可见的模型判断。结果是这两种实际输入配置的比较，不能直接解释为“只有记忆长度不同”的纯控制实验。所有条件都支持按普通录制时标`第N段T秒`检索，不用私有证据ID做oracle召回。

## 判分冻结

编译执行器、RequestAgent、权限适配器、判分器的hash在QA前保存于`code-freeze.json`。预测前修订保留superseded版本；QA开始后不允许重冻。题库不会按预测改答案。

盲评使用独立fresh context的qwen3.8-flash，给问题、参考答案、原始引用/参考图像，不给实验条件或系统身份；审核目标答案与附带事实。它仍是**同模型家族自动评判**，不宣称独立人评。规则与原始judge响应保留，可复审。

- 内容正确但没有合法历史证据：语义正确性诊断可得分，但任务解决不得满分。精确到指定记录时刻的题要求该时刻证据，不以相似房间的其他图替代。
- 单题任务分0/0.5/1；可信损害0/0.25/1。无法核实的信息正确拒答得分，不可知却猜测扣重大损害。
- full-history正式开发卡：问题解决=90题任务分均值；长程与干扰=长期组及对照题的任务分均值；回答可信=1−损害均值。三卡不合成总分。
- 当前/短期/长期每组30题，在三个条件分别展示任务解决与回答可信；语义正确性只作判断猜测捷径的附页诊断。
- 这是冻结的静态学校任务profile；对象状态变化、自然找物、其他环境泛化仍未测，不复用旧六类配额冒称全能力通过。

## 预算与价格依据

官方PAI Token Service价格页：https://www.alibabacloud.com/help/en/pai/product-overview/billing-of-pai-token-service 。2026-10-17检索到北京qwen3.8-flash公开价：输入USD0.1356/百万token、输出USD0.4584/百万token。端点为北京maas服务。按未打缓存折扣的公开价估算，**不是账户合同价或真实账单保证**；SDK零费用不当免费。

执行前保守预留128k输入及各阶段最大输出，另设实际请求/token上限。公开价估算上限：建库4美元、冒烟0.5、冒烟判分0.2、全量问答3、全量判分1.5；合计9.2美元。用量缺失、达到预算、超时或协议失败则停机并保留日志，不自动重试或继续下一题。真实账单仍需账户核对。

## 复现入口

```powershell
python sim/prepare_memory_evaluation.py <school-sample> <90-question-bank> run/school-memory-evaluation-v1
npm run build
python sim/freeze_memory_evaluation.py run/school-memory-evaluation-v1
node --use-env-proxy dist/sim/spatial-calibration.js run/school-memory-evaluation-v1/model-replay run/school-memory-evaluation-v1/memory run/school-memory-evaluation-v1/memory-config.json --confirm-paid
node --use-env-proxy dist/sim/memory-evaluation.js run/school-memory-evaluation-v1 smoke --confirm-paid
node --use-env-proxy dist/sim/memory-evaluation-grade.js run/school-memory-evaluation-v1 <90-question-bank> smoke --confirm-paid
node --use-env-proxy dist/sim/memory-evaluation.js run/school-memory-evaluation-v1 full --confirm-paid
node --use-env-proxy dist/sim/memory-evaluation-grade.js run/school-memory-evaluation-v1 <90-question-bank> full --confirm-paid
```

以上是顺序入口，不表示后续阶段已跑完；真实进度以每阶段complete/stopped与usage为准。

## 中断恢复记录

首次进程在131/217已提交窗口处退出，未产生正常结束标记；数据库有514已提交观察与4个pending。请求目录263个已落盘响应，另1个只有input、响应/实际计费未知，不能按0计。恢复时重新统计所有原始响应，未知请求保留128k输入/1800输出的完整预算预留；实际金额保持未知，另报公开价估算上界。原始请求、失败标记及每次resume快照均保留。

首次恢复触发重复插入pending观察的顺序校验，未发起新模型请求。已修复为保留已提交前缀、跳过已落盘pending的重复ingest，在原窗口flush处重试未提交窗口；识别器/题库/QA与评分冻结文件不改。mock测试验证：已提交观察不重复计费、pending正常恢复、历史缺用量请求仍占保守预算。不要把恢复称为所有旧调用均已查明账单。

后续可用事件驱动顺序执行器（等待子进程退出，不轮询）衔接阶段：

```powershell
node --use-env-proxy dist/sim/run-memory-evaluation.js run/school-memory-evaluation-v1 <90-question-bank> --confirm-paid
```

完成阶段通过标记跳过；未完成失败阶段不自动覆盖。日志`pipeline-state.json`和各阶段文件共同审计；只有`full-grading/complete.json`与完整270条执行/判分才可宣称首次评测完成。

## 建库完成与冒烟输出失败分类修正

### 全量中断续跑（2026-10-18）

全量最终已记录270/270次，包含两次未重试的执行错误（请求中止、单题调用限额）。统一判分在181条有效分数后因judge第182次返回600token截断说明文字、没有JSON而停止。该原始响应与费用保留，不猜测其分数。判分器新增断点加载有效分数，剩余调用加`response_format:json_object`传输约束；rubric、模型、评分权重不变，仍在原累计请求/费用限内。原freeze/rubric归档、post-prediction修订记入当前freeze。只重做未形成有效分数的judge调用，不重跑270条问答，也不按分数择优重评。最终报告需披露评判格式约束在中途加入。

v2的18次冒烟和判分完成，全量记录229/270次后，第229次请求被中止而停机。前228次和第229次基础设施失败全部保留，不重试该失败题；通过`memory-evaluation ... full --confirm-paid --resume`只执行剩余41次。累计请求/token预算沿用，缺用量的中止调用额外预留128k输入/512输出，不宣称实际账单。最终失败题任务分0，保留在对应时间层次分母；无错误答案送出不按误导性回答扣风险。

为支持续跑，执行器和判分器有**预测后的基础设施修订**，不是原冻结完全不变。`code-freeze.pre-continuation-*.json`、原provenance/usage副本保留，当前freeze记录明确amendment；模型、问题、提示、权限范围、答案、评分权重不变。不将失败题移除以改善成绩。最终报告须披露中止失败及此次修订。

统一建库已完成217/217窗、851观察、pending=0。含中断恢复在内436次请求记录；已知输入4,111,269/output257,477 token，另1个无响应请求保留完整预算。公开价估算上界USD0.6936974532，实际账单未知。

v1冒烟完成前5次，在第6次full-history当前题因模型未经inspect却输出引用，被校验拒绝。日志、原始回答与16次请求用量保留于`run/school-memory-evaluation-v1/smoke`，未启动后续题。此失败说明“模型答案拒绝”不能与“网络/计费/系统权限异常”同类停机，否则无法测量模型的真实失败比例。

修正执行器而非放宽引用规则：RequestAgent仍拒绝非法输出，但返回携带原始模型文本的专用异常；新评测器将其记录为`modelOutputRejected`，任务分为0、保留盲评和非法引用风险，继续后续题。网络/用量/输入完整性故障仍停机。风险分审核的是模型提出的回答；被校验器拦截不意味着用户实际收到了错误答案。没有以“答错”为由重新采样同一题。

新运行`run/school-memory-evaluation-v2`重新冻结全部执行/评分代码，从相同6题重新跑完整18次冒烟，再放行270次；不是只挑失败题重跑。原90题、答案、题序选择、模型参数、记忆库不变。通过`--reuse-memory`验证完全相同的replay hash并只读复用v1统一库，不重新付费建库。v1失败调用费用另记，不从总账中删去。相关工具链/真实RequestAgent mock测试通过。
