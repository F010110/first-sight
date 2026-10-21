# 当前感知与身份动作分离实验 v1

状态：2026-10-21已实现独立实验链；首轮因过严的参考核验中断并完整保留，修复后正在重新执行第6段32观察双臂试验。尚未证明空间语义正确，不替换前端空间包。

## 为什么不是继续修改v2提示

[前两轮完整对照](spatial-identity-comparison-experiment-v1.md)仍有56—80%空身份，且模型会复制旧reason，或明确描述新区域但返回null。因此这次拆开调用与决策职责，而不是再次要求模型在同一JSON中同时描述、比较、生成UUID。

早期`scene-agent.ts`已有独立当前感知及same/known/new/unresolved思想；本次不是首次提出该原则，而是将其作为当前统一Context校园链之外的显式对照策略，采用现有SQLite／原图检索接口，保持旧链不变。

## 实现与信息边界

1. `spatial-separated-protocol.ts`：当前感知只允许observationId、region、clearRegion、layoutEvidence、uncertainties、最多2个短检索词及当前来源引用。禁止placeId／历史动作等额外字段。clearRegion不能仅有名称，至少两条可见布局事实；这不是视觉正确性的保证。
2. `spatial-json-vlm.ts`：每次是无聊天历史的独立请求。perception阶段代码层拒绝历史字段和非当前图片，CURRENT／REFERENCE图片按front／left／right明确标记。原图PNG／SHA256校验，input.json只存元数据／路径／hash，不把Base64塞进Context。使用`qwen3.8-flash`、enable_thinking=false、temperature=0，保留原始响应、usage、未知计费预留、网络失败及预算停止。
3. `spatial-separated-agent.ts`：先得到当前感知，再从当前运行的SQLite检索；选择紧邻观察、当前身份较早代表及最多剩余名额的历史候选，总计最多3来源。候选文字／model-statement不是图像证据；必须实际inspect、校验来源早于当前，才能送入身份比较。
4. 身份阶段只看到当前独立感知、当前三视图、实际历史三视图、来源角色与hasIdentity。**不发送旧reason、旧模型outputs或UUID。** 模型选择continue／establish_candidate／revisit／unknown并逐图比较。程序把选择的来源绑定到既存UUID，或仅在模型明确选择建立候选且通过证据流程检查时请求SQLite建立候选UUID；不能自动从“different”文字推断新建。
5. 同区域却重复新建、关系不明却当边界、没有已inspect身份却复用、不同录像却continue、所选同一身份的参考图存在正面different矛盾，均不能提交。较早参考图因遮挡／视角不足产生的uncertain不是正面矛盾：在明确最近原图same支持下，只保留single-reference候选，记录unconfirmedReferenceIds，不伪称multiple-references确认。协议最多2次调用，失败保留未完成观察并停止该臂，不制造“成功拒答”或吞掉执行失败。
6. 经历片段segmentId与地点身份分离：明确同区的未知身份观察仍可组织在同一经历片段，但placeId保持null；录像切换／超过60秒空档不延续经历。片段写入事件及model_outputs日志；没有实现跨重启恢复、自动追溯合并／拆分或全量导航图重建。

UUID由程序生成不等于程序证明空间正确。动作校验仍不能阻止模型写出自洽但错误的same／different，必须审核实际图片和输出。

## 本轮冻结范围与预算

```powershell
npm.cmd run build
node --use-env-proxy dist/current/desktop/experiment-separated-spatial.js --confirm-paid
```

- 新选第6段0—62秒，32个原始三视图观察，0.5fps；没有复用前两轮第1／4段调试结果，不输入旧预测或真值。
- 两臂都逐观察执行：control为既有统一判断链，separated为独立当前感知＋身份动作。这与前轮4观察窗口不同，必须单独报告，不能跨运行拼结果或将差异全部归因于某一提示改动。
- control至多48实际请求／估算USD0.20；separated至多96请求／USD0.40，合计上限USD0.60。新策略多一个感知阶段，调用成本与延迟不能与旧链假称相同。
- 运行前冻结源码hash、公开观察ID／时序、旧库hash和私有检查hash；每臂从空库完整运行，失败／中断保留，不挑成功片段续接。
- 独立于模型输入的人工开发检查：第6段16秒和48秒的球场内部同区；16／62秒、48／62秒球场内部与围栏外石板路径应不同。三个配对共用观察、不是三个独立重访事件，也不是完整区域标注。16／48／62秒三视图已直接查看；0／32秒仅抽看前图，不对其强行设真值。
- 第6段不曾用于前两轮局部调试，但仍出自既有校园数据、仍由同一开发者选样，不称独立留出验收。

## 执行前验证

全套264项TypeScript测试通过：包括感知无历史／无身份、模型不接收UUID／旧reason、运行器绑定候选、未知身份不继承旧placeId、断拍隔离、未来来源拒绝、有限协议失败不伪造提交、无历史单请求HTTP载荷、原图hash、预算与计费预留。随后补充历史原图重访绑定及HTTP失败保留单测，8项相关测试再次通过。

旧空间包、原90题冻结分数、既有真实问答及前端回放均不修改。当前仅独立实验，结果出来后先审核，不自动上线或扩大全校园。

## 首轮中断：未知参考不等于正面冲突

`run/spatial-separated-experiment/2026-10-21T09-41-48-973Z-a9a5ffe6/`：control完整32观察、4地点、3空身份、32请求、估算USD0.0187927992；separated只提交3观察、1候选地点、0空身份、8请求、估算USD0.0033505776，第4观察未提交，两臂未知计费预留0。关键16／48／62秒未到达，不能评价分离策略的球场／路径效果。旧库hash不变。

失败时刻为第6段6秒：identity请求0007对最近4秒原图给same，对0秒较早代表给uncertain，具体理由是“anchor视角主要展示了紧贴砖墙底部的狭窄通道，未清晰呈现当前视野中开阔的铁丝网围栏边界，无法确认是否为同一具体位置”。原程序把所有非same都当成矛盾，且在有限协议修复外直接停止，过于严格。

修复：正面different仍阻断身份复用，并进入有限协议反馈；uncertain仅表示该原图不提供足够佐证，不当作different。在另一个原图有正面same且当前区域清楚的情况下，允许单参考候选延续，同时显式记录supportingReferenceIds／unconfirmedReferenceIds及single-reference支持级别。此举不能消除相邻视图链式漂移风险，也不证明物理区域正确，仍需检查较远代表和边界。

新增单测验证uncertain不会被错误当成正面冲突，同时different矛盾仍两次以内拒绝、不提交身份；10项相关测试通过。新schema为separated-spatial-experiment-v2，两臂从空库重新运行，原始中断不续接。报告补充storedObservations／pending，失败时原始观察保留但未分类不能被漏算为已完成。

第6段起始6秒现已用于实现诊断，不再将该段称作未接触的留出集；仍不读取或调整私有16／48／62秒配对来改输出。当前新运行只验证本次明确修改及原始效果，不作为独立泛化结论。
