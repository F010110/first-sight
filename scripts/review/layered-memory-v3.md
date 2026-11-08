# 分层视觉记忆 v3

有效设计见 `docs/active/01-spatial-memory-architecture.md` 的2026-11-08分层契约；进度见TODO。

新入口，不覆盖旧service/runner/数据库：

```powershell
npm run build
node --use-env-proxy dist/current/sim/evaluation/run-layered-memory.js PUBLIC-INPUT.json NEW-OUTPUT --confirm-paid
```

也可用`npm run memory:layered -- PUBLIC-INPUT.json NEW-OUTPUT --confirm-paid`。这只是入口说明，执行会产生费用，需用户授权；不能把文档命令当作付费运行授权。

默认快速感知6000ms、空间巩固40000ms。尊重源时间节拍投递，不等空间Agent。
`--quality`是显式离线全覆盖基线：在空间/感知接纳上限之前等待，不按实时节拍投递；等待也有超时，失败前缀不继续。不能以该模式认证实时。
`--time-scale=2`显式投影源时间，不伪称原时间；`--limit=N`明确前缀。
`--resume`恢复同一输入、配置、Session和工具版本；`--retry-failures`显式有限重试失败前缀，容量不足或预算耗尽拒绝。不自动运行任何付费实验。

加入`--serve=8789`开放仅127.0.0.1的问答通道，启动打印随机bearer token。空间版本0、后台忙或失败时均可问答。请求：POST `/question`，Authorization: Bearer TOKEN，JSON `{"question":"前面是什么？"}`。GET `/status`同样需要token。不允许跨源浏览器调用。回放结束后服务继续提供问答，Ctrl+C关闭。问答繁忙时明确409，不创建无限队列。

## 存储与边界

- `evidence/observations.sqlite`（观察归档schema-v2）：原图来源、不可变事实/可用时间、单调evidenceRevision、独立感知与空间任务、缺口/补齐记录。原图在`evidence/originals`。问答固定事实提交序号和空间版本，即使时间戳同毫秒也不能读到启动后完成的事实。外来/不支持的旧库拒绝打开，不自动迁移。
- `memory/spatial.sqlite`：沿用v4地点/访问/笔记/名称属性/关系/修订/Context表，增加批次事务收据。批次所有片段和真实Pi检查点绑定一起提交；失败全部回滚。
- `space-session`、`question-session`：两个独立Pi Session和role skill hash；空间提案耐久绑定真实tool call/result与tip。
- 三条请求分别计费/限额；空间和感知不能占用问答请求槽。有限请求超时与轮次，超时不会释放仍在执行的空间写入者。
- 空间/问答各自有独立Session压缩；问答的动态空间/视觉模块另按固定规则保留最近尾部与来源索引，不能用私有会话摘要覆盖它。完整事实/图片仍在长期库，未在当前工作视图交付的事实须读回。
- 默认不把整批原图交给空间Agent。广候选按快速证据范围召回；当前/历史原图由同一空间Agent按需inspect。
- 问答亦可按需调用只读`memory_revisit`，固定本问题空间版本；它不往空间DB写候选事件。默认使用独立、有界的本地matcher工作进程以避免等待后台匹配，不是第二个空间/重访判定Agent。
- `observation_timeline`/`observation_find`可读尚未空间建模的独立事实，搜索是字面候选而非定位答案；预览不算完整读回。没有空间结果仍可回答有来源的视觉/历史观察问题。
- 空间批次可提交多个有序片段；`batch:0`等局部引用表示同批早先new身份，库生成真实ID。地点/访问、notes、rename、属性、关系、历史修订保留旧语义。
- 一批早期片段的知识截止仍是整批尾时刻，所有片段共享整批最终发布可用时间，而不是内部保存点的时间。批次收据绑定事实可用时间、原图hash和真实Session tip。历史查询/地点档案/名称按批次知识截止和实际提交可用时间过滤，不把后帧知识冒充早帧当时已知。
- 初始配置：感知8个在途任务/120秒源跨度/64MiB证据预算；空间4个在途任务/160秒/128MiB。感知每任务最多8次观察、空间最多64次观察（默认2秒节拍的40秒批次通常20次）；这些都是上限而非强制凑满。恢复与显式重试同样检查门禁。归档默认10GiB保守逻辑预算，不是操作系统物理配额。
- 单HTTP请求120秒，空间最多24轮；空间外层兜底覆盖整个有限请求/重试预算，而不是把120秒误作整个Agent的推理限时。后台429有限冷却并仅重试一次；无穷重试/无限等待不被允许。fast部分输出保留成功事实，只补漏帧，并有有界单帧回落。
- 过载观察归档但不无限加入待办，缺口显式记账。失败空间前缀停止，后续问答/感知仍可用。`completed`要求所有计划观察连续处理且无未解决缺口，不能只看最后版本或状态数。

免费测试验证机制不代表模型重访precision/recall达标；真实模型质量/费用/持续吞吐仍需用户授权后的实验。尚在原架构后续计划中的独立经历、通用合并拆分、层级、实体/事件等能力不因本迁移取消，也不宣称已经实现。
