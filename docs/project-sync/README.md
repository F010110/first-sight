# First Sight 项目信息同步区

> **本目录现为历史记录。有效架构与设计理由见 [../active/README.md](../active/README.md)；当前状态、待办及维护见 [TODO.md](../../TODO.md)。以下“当前/最新”限定在各自历史阶段，不能自动作为执行依据。**

快照日期：2026-10-27。用途：让用户、新会话和协作者共享**已知事实、最新决策、证据入口和未知项**，避免反复从长对话或TODO猜测状态。

这不是新的源码/数据副本，也不是“读完了仓库所有文件”的声明。覆盖本轮产品工作的已知信息；其他领域通过来源索引继续核查。没有把密钥、私有固件、原始影像或独立research内容复制进来。文件夹本身不会自动同步到其他机器或服务。

## 阅读顺序

|文件|内容|
|---|---|
|[00-current-state.md](00-current-state.md)|一分钟当前状态、版本、当前最重要的未知项|
|[01-goals-and-decisions.md](01-goals-and-decisions.md)|产品目标、用户决定、已经被覆盖的旧方向|
|[02-architecture-and-code.md](02-architecture-and-code.md)|当前实现、职责、代码入口、未接入能力|
|[03-data-and-artifacts.md](03-data-and-artifacts.md)|数据、题集、运行目录、位姿/标注/许可边界|
|[04-evaluations-and-costs.md](04-evaluations-and-costs.md)|所有本轮关键成绩、失败、费用及解释|
|[05-hardware-and-runtime.md](05-hardware-and-runtime.md)|硬件、网页、默认开关、环境及故障|
|[06-testing-plan-and-open-questions.md](06-testing-plan-and-open-questions.md)|最新准确率讨论、下一工作包与待确认事项|
|[07-research-and-history.md](07-research-and-history.md)|参考研究区别、历史图/序列实验、方向变更|
|[08-handoff-and-update-rules.md](08-handoff-and-update-rules.md)|交接规则、安全边界、维护方法|
|[09-sources.md](09-sources.md)|原始文档/报告入口和可复核命令|
|`repository-catalog.json`|可重建的文档与源码文件清单；只有路径/大小/哈希，不复制内容|

## 信息等级

- **决定**：用户已表达的目标或约束；不是自动授权无限采集/付费。
- **已验证**：有本地代码、测试或原始运行报告支持；标明范围。
- **历史**：旧阶段事实，不能当当前默认策略。
- **建议**：助手提出但尚未实施或验收的方案。
- **未知/未验证**：没有证据，不能用推测补齐。

## 冲突处理

最新用户指令优先于本快照；本目录的当前状态优先于历史文档中“当前”措辞。原始账本/冻结输入/实际代码是事实核查依据；若与摘要冲突，应记录差异并更新摘要，**不要为了匹配摘要改原始证据**。`TODO.md`保留工作状态，本区保留知识与解释。

特别注意：`docs/README.md`及部分旧文档仍提v2.0.0；正式产品冻结版是v2.1.0。实验新增代码与Git当前HEAD也不等同正式发布。
