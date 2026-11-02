# 空间内容审查：旧状态残留与独立当前证据

## v1全量完成，但未通过内容审查

`run/unioncity-pi-spatial-replay-v1/complete.json`确认813/813完成。`run/unioncity-pi-spatial-replay-v1-audit1/audit.json`结构审计0错误，保留3项历史失败/异常路由记录。这不等于空间语义正确。

抽查发现：最初“无法确认具体是站台的哪一侧（上行或下行）”在802条更新中原样出现，已到店铺、洗衣店、露台仍重复。779/793等更新还残留电梯内、走廊等不适用于当前观察的位置假设。原图71可见绿色桌子、柜台和货架，直接细节大体对应；但动态假设及未决状态维护明显有缺陷。没有开始新架构的问答评分。

## 短段修复仍暴露历史压过视觉

先修Skill：每次输出完整当前状态，不复制无关旧hypotheses/unresolved；无适用项用空数组，历史记录保留而非删除。模型时间输入只使用atMs毫秒，sourceAtMs留在外部来源信息中，避免混合时钟。

`run/unioncity-pi-spatial-state-prefix90-v1/`首条因模型返回扁平参数而非工具外壳失败，保留。增加显式单工具传输格式：只有声明恰好一个工具且启用singleToolArgumentsAllowed时，直接参数对象可交给同一个工具schema校验；不猜语义、不修改引用、不补字段。多工具问答不启用此格式。

`...prefix90-v2/`完成90/90，但第90组的正前方原图已朝向街道，模型却描述旧柜台和绿色桌子。只改文字不能解决历史上下文压过当前图像的问题。

## Fact-first修复与短测

- 新增current-visual-evidence Skill：在没有历史、问题或地点猜测时独立检查当前三摄。
- 连续空间Pi session读取currentEvidence，再产生可修订summary/hypotheses/unresolved。
- 直接observations由独立检查结果原样附入更新，组织Agent不能改写；这仍是模型观察，不冒充人工真值。
- 观察提取请求只有current和本时刻三图；组织请求不带图片，用明确来源的固定当前观察与过去session推理。

`run/unioncity-pi-spatial-state-prefix90-v3/`完成90/90；`...-audit1/`核对全部独立观察、组织输入和最终提交的observations一致，结构0错误、无历史失败。第90组正确描述front朝向街道而左右仍在室内。已查看71和90原图核对相关细节；这不是对90帧全部语义的人工认证。

仍需注意：短测hypotheses会把普通灯具/瓷砖相似强推为地铁附属房间，并用“极可能”表达。这不是已认证身份，后续全量审查要重点检查关联和摘要是否把猜测升级为事实。不得因为direct observations正确就宣称空间Agent完全可靠。

## 正在全量重跑v2

后台shell `sh_19a954126001s0pYRF6mMrBGax`：

```
node dist/current/sim/evaluation/replay-pi-spatial-session.js run/unioncity-questions90-v2-run1/input.json run/unioncity-pi-spatial-replay-v2 --confirm-paid
```

从原始三摄重新开始，不继承有残留状态的v1。原完整运行、三个90组短测和未知用量全部保留。问答freeze默认改为v2，避免错误地把完成但内容有缺陷的v1直接用于问答。

后续仍是：全量结束 → 来源/时间/压缩审计 → 空间内容检查（必要时先修）→ 原题问答复测。没有启动90题问答大测；这里的90是原图前90组诊断，不是90道问题。
