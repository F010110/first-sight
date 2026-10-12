# v1.1.0-test.4：固定边界聚合算法与人工视频审查研究版

日期：2026-10-12。稳定应用基线仍为 `v1.0.0`；本标签是研究快照，不是可靠性验收通过。

## test.4固定范围

边界算法v1已固定：[协议与提示hash](research/boundary-region-algorithm-v1.json)。qwen3.8-flash、代表抽样、单次全局调用、主体/边界/未知输出、缺核心引用安全隔离均冻结。val4新协议44粗粒度核心查询44/44，边界4/13检出，不认证完整57帧样本归属。原test.3结果与标签保留。

真实扩展val5：40观察/23原组，原模型答复10组缺主体引用，校验失败保留并确定性隔离；最终24主体/5边界/11其他未知。无完整标签，准确率未评定。没有为提高分数重复调用。

两场景人工审查网站含97样本/292连续视频帧，可查看算法预测与原AI审查，人工修改独立导出。[启动与限制](research/human-review-site.md)。人类尚未完成审查，浏览器交互验收受会话无桌面连接限制；不是公网已部署服务。

默认生产/手机旧链路不改，新协议是正式固定的**研究基线**，不等于生产或导航可靠性通过。提示微调须另存完整新版本hash；输出接口/抽样变化另立算法协议。

## test.3历史基线（保留对照）

- 44固定查询：即时/10模拟秒/最终可修正分开评分；默认最终50.0%，可选回溯修复61.4%。
- 全组视觉聚合完整失败曲线18→1，自动停止失败与事后峰值均保留，不挑最好K宣称成功。
- 可选VLM全局聚合：全部18组、36三视图代表、单次调用。默认模型`qwen3.8-flash`，粗粒度开放生活区32/44=72.7%、未知12；细粒度16/44。plus此前输出粗粒度44/44、细粒度28/44分别保留，不混用模型。
- 粗粒度是用户认可的厨房/客厅合并标签新版本，不覆盖旧标签。核心开发样本高分不证明13排除图或实际设备归属正确。
- [Flash拒答原图诊断](research/vlm-abstention-diagnosis.md)：原组含门口过渡代表，整组不可拆接口使不确定性扩散。尚未解决，不强迫模型输出。
- 广角渲染可选FOV/合成鱼眼，针孔VO拒绝未经校正鱼眼；未运行新THOR广角路线，未实物标定。
- 头盔采集接口保留，硬件仅采集、电脑处理；手机方案归档，真实驱动尚未实现。

算法/选择/接口/数据和旧模型响应固定；提示词微调须另立版本，保存新输入hash与结果，不能覆盖此基线。拆组或改变代表采样是接口/算法变更，不算单纯提示微调。上述模块均独立实验，默认pipeline及生产请求链路不接VLM聚合。

## 固定范围

- 保留原图、时间、历史物体检索、拒绝证据、可撤回修订与持久化。
- 时间连续归属与历史组身份分开；当前归属不是已验证的物理区域，更不是导航许可。
- 默认研究链路：前/左/右三视图离线观察、视觉证据、当前经历分组、逐前缀回放。
- **回溯修复可选**：独立 `src/sim/retrospective-repair-trial.ts`，不被默认 pipeline 导入或启用，不改原始归类日志。
- 手机应用与研究分开。此轮不改实时 Agent、手机采集与接入逻辑；不把单摄手机当作三摄设备。此前版本包含应用改动，本版不声称完整手机回归通过。

## 已知结果和失败

val4开发集44张已审核心图片：默认归类有2个混合组、13/703错合并对；可选修复后1个混合组、5/703错合并对。同区域聚合率24.7%→26.3%。首次旧组识别17/40、新组建立1/4没有被事后修复改写。

修复v1有1次正确、1次错误事件，失败报告保留；v2有1次正确、0次错误事件，涉及53/54两张图。**单次成功不是可靠精度**。val5无修复提案，缺完整标签。两套真实时间回放均无受支持的历史组匹配；正式结论仍不符合。独立盲审、固定正确历史分组分类对照、版本适配与手机实测仍欠缺。

## 检查入口

```powershell
npm.cmd ci
npm.cmd run test:memory
npm.cmd run test:visual-pipeline
npm.cmd run test:retrospective-repair
npm.cmd run test:classification-standard
npm.cmd run test:grouping-benchmark
npm.cmd run test:helmet-capture
npm.cmd run test:research-snapshot
python scripts/check-doc-links.py
python sim/test_navigation.py
```

这些是软件机制回归，不是可靠性认证。离线真实回放需要本地录制与缓存证据，`run/`数据不随版本发布。依赖见根目录 `requirements.txt`。

test.3当时检查：memory 75、visual-pipeline 61、helmet/repair 7、Python research-snapshot 38、navigation 1通过，文档链接检查通过。test.4实际检查：构建、research-snapshot 45项、链接、页面JS语法、两套视频完整解码与本地HTTP资源200通过。未完成桌面浏览器内交互验收。Python套件含重叠测试，不相加为独立能力数；不调用付费模型API。

## 阅读与复现

- [研究与手机应用鸿沟](research/research-application-gap.md)：硬件/输入、时序、校准与实时验收的独立阻塞。
- [建议材料索引](notes/suggestions/README.md)：原文集中归档，不作为完成状态。

- [当前研究架构和默认回放](research/temporal-continuity-integration.md)
- [可选修复实验与命令](research/retrospective-repair-trial.md)
- [固定评分标准](research/temporal-image-classification-standard.md)
- [配对版本验收契约](research/grouping-acceptance-pipeline.md)
- [报告索引](experiments/README.md)：保留JSON报告路径，避免破坏评测输入与历史证据。
- 根目录 `TODO.md`：未完成事项和验收阻塞。

目录分工：`docs/application/`应用；`docs/research/`当前研究；`docs/archive/`历史实验与设计；`docs/experiments/`不可变数值报告；`docs/notes/`讨论材料。历史档案不代表本版结论。
