# 持续空间模块 + 用户问答模块（替代问题fork方案）

用户进一步明确：用户问题Agent不是空间session的静态fork。它有两个上下文模块：持续更新的空间记忆，以及独立积累的用户问题/调查/回答记录。

## 当前实现

- `SpatialContextModule`发布空间记忆最新已提交版本，拒绝版本倒退。
- 问题Agent使用独立Pi session，空间消息不复制进其存储。每次模型请求前，`transform_context`将当前空间模块与问题session消息组合。
- `liveSpatialContext`接入共享模块及该版本的事实快照；空间更新后，在下一请求边界同步空间消息、可检索记录和当前图。保留原问题的questionAtMs，避免把持续更新的现在误当提问时刻。
- 问答完成后，只给问题session追加completed-question-context。空间Agent不接收这段问答，也不因问题Agent更新而被改写。
- 可通过questionSession元数据继续同一用户会话；不从空间session fork问题会话。
- 离线评测固定某时刻的空间模块，避免未来信息；这只是评测时间隔离，不是产品架构。

核心文件：`src/assistant/harness/layered-context.ts`、`first-sight-harness.ts`、`spatial-session.ts`。

空间session writer现在公开contextModule和snapshotAt，并在检查点耐久提交后publish新版本。服务的Pi入口必须显式连接这个来源，不能悄悄回退旧60秒窗口；服务保留同一个用户问题session供后续问题继续使用。

## 验证

专项测试验证了同一次问题处理中发布新空间版本后，下一模型请求看到新空间内容，保留原问题时间；用户session存储不含空间record_context消息；固定版本的评测不含未来哨兵；问题完成不会改变空间源文件。另验证独立上下文快照、工具/Skill、压缩和来源权限。

完整本地测试489/489通过。随后补充同一用户session继续第二个问题的断言，重新编译及空间session专项3/3通过：新调用同时含更新后的空间模块和上次问答记录，空间源文件保持不变。

## 完整空间重跑进度与恢复

首次重跑已提交107/813，108号请求发生fetch failed，保留原失败、请求和未知用量。尚未完成全量，不开始新的问题评分。

已实现并测试断点续跑：只从最后已提交空间检查点恢复，失败session文件不改写；空间恢复使用新的耐久会话继续同一时序前缀。这是故障恢复实现，不是用户问题session fork。每个时刻记录各自实际session元数据及context哈希，后续freeze绑定全部源session文件。

续跑命令已后台启动：

```
node dist/current/sim/evaluation/replay-pi-spatial-session.js run/unioncity-questions90-v2-run1/input.json run/unioncity-pi-spatial-replay-v1 --resume-paid
```

以complete.json为全量结束凭据。完成前不能把107个context当813个，也不能拿先前旧窗口小试代表这个双模块架构。

在线服务尚未自动切换；仍需把持续空间session的publish事件接入正式服务，不能用旧窗口兼容入口宣称产品迁移完成。
