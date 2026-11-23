# 三Agent基础实现与真实运行时小样本

2026-10-31。按用户批准的“两常驻＋按需交互”实现，以First-Sight原代码为主，参考LightMem-Ego的先入库/异步完善/partial原图回退思想，未复制第三方源码或替换研究目录。

## 已实现

- `three-agent-store.ts`：SQLite WAL原始经历索引、两条持久任务链、180秒租约、20秒续租、token fencing、原子提交、memory版本检查、来源/时间校验。即时任务可显式superseded，原图及经历记忆任务不删除。过期running任务可恢复，failed任务不静默重试。
- `three-agent-service.ts`：即时观察A、经历记忆B各串行、彼此并行；B直接读原始经历，不依赖A成功。交互C按需调度。A/B默认最多2个后台请求，总并发最多3，给C（包括Planner）预留1槽。问答仍需等待自身模型推理，不保证2秒返回。
- 采集完成语义是“原件与索引已保存”，不等待VLM。模型处理状态另记；暂停后不启动新后台请求，已发请求可迟到提交历史结果，不作为当前状态发布。
- `three-agent-factory.ts`：自有PNG原图或JPEG原件＋无缩放PNG模型视图；A单次当前事实，B单次联合空间/事件整理，C有限文本检索＋partial近期原图回退。B上下文当前＋最近2个记忆观察，C最多交付3观察；尚非成熟长历史检索。
- 各role独立计费上限：A64调用/USD0.15、B128调用/USD0.30、C32调用/USD0.15；Planner另为既有最多64调用入口。provider支持恢复usage账本，未知reservation不清零，旧工件不能覆盖；不是无限额长期运行配置。
- `ObservationService`增加可选独立观察通道和shutdown/resume接口，`AssistantRuntime`保持旧默认行为，仅新service绕开模型串行阻塞。真实`QwenPlanner`/能力路由和问答使用原运行时。
- `server.ts --three-agent`为可选实验模式。原8884/8886未重启，旧默认未替换。新模式find/watch暂时禁用，不冒充关注检测已集成。运行状态可从`/api/state.background`读取。

## 验证

build成功，44项相关测试通过。覆盖：采集不等A、B不等A、问答不等B清空、同lane不能双写、未来证据拒绝、版本冲突、暂停/恢复、租约重启恢复、迟到提交隔离、账本恢复、交互保留槽和原服务器回归。

5/15/60秒延迟测试使用阻塞promise＋可控源时钟，不是实际等待60秒或真实供应商限流实验。它们证明结构上的不阻塞与时间归属，不证明无限过载下完整理解全部画面。

### 三轮小样本，均保留

输入同一GMod重渲染路线的4个观察，不是192观察全量、不是按源时间播放，也没有独立准确率gold。通过`run-three-agent-pilot.ts`实际调用AssistantRuntime＋QwenPlanner，而非只调用空间子模块。

1. `run/gmod-three-agent-pilot-v1/`：4原始经历入库，B4/4，问答完成；暴露partial问答仅附最新图，未充分回退原始历史。保留结果，随后修正。
2. `...-v2/`：补近期原图回退后问答能引用地铁/街道历史；B3/4，一条模型facts引用未包含于顶层sourceIds，校验拒绝，后续任务继续。没有修补模型引用或自动重试。
3. **最终结构`...-v3/`**：已给交互保留独立槽；4原件均保存，逐观察落盘耗时约15–71毫秒。提问时A/B都在工作、B版本0且4条未完成；Planner选择memory.query，约4.1秒后交付带3个原图ID的历史回答，明确partial而非等待B全部完成。
   - 最终A：1条done、3条superseded；B：3条done、1条failed，memory version3/pendingMemory1。
   - 失败原因`Undelivered evidence cited`：B摘要传递了更早证据引用，模型将未在本请求交付原图的来源混入输出。安全门拒绝而不放松约束。**尚未修复，不能称记忆全量成功。** 后续需要分离“历史摘要来源”和“本次直接视觉来源”，而不是删引用或放行。
   - 7次实际请求（含Planner），估算USD0.003265；三轮合计约USD0.00866，非账单。

实际结果/任务/原始请求/响应/账本及代码hash均在上述目录。未进行房间重访准确率评分、未发布新视频。

## 可选启动，不改用户现有端口

```powershell
$env:FIRST_SIGHT_DESKTOP_PORT='8890'
$env:FIRST_SIGHT_THREE_AGENT_ROOT='run/three-agent-local-v1'
npm run build
node --use-env-proxy dist/current/desktop/server.js --three-agent --confirm-paid
```

需用户已配置自己的Qwen环境；不打印密钥。省略`--confirm-paid`只存档、不开模型。复用同root可接回任务及持久模型账本，capture.start后恢复；租约未过期时不会争抢旧worker。不要删账本来重置预算。

## 下一步和边界

- 修复摘要间接来源与本次原图直接来源的结构化区分，保留不受支持的断言为未决，不能靠放松校验制造成功。
- B当前仍逐观察消费，未完成微事件合并/低冗余触发接入，长期2秒输入仍可能产生持久任务积压；此实现解决的是隔离阻塞和可追踪恢复，不声称已消除长期算力缺口。
- 原始存储需要容量/保留策略和磁盘预算监视；当前不是无限采集生产配置。
- 物品持久ID、精确空间图及跨session房间身份、深度重访核查、完整历史工具检索仍待实现。
- current回答在完成时已过期会拒绝作为“现在”发布；这不代表即刻理解当前现场，不能当安全导航能力。
