# LightMem-Ego：生活长期记忆的直接产品参考

核查：2026-10-27。全文v1＋官方仓库局部核心代码静态检查。未安装/执行上游、未调用其公共demo、未上传私人数据。源码固定commit `3c023dfec301bb2f9624f82cee76007ac3ac0646`。

## 结论与前述判断修正

**LightMem-Ego是目前本轮核实工作中，与“持续生活采集→分层记忆→找物/历史问答→自然语言回答”非常接近的直接参考系统。** 之前重点围绕惯性拓扑定位及机器人benchmark，低估了这一产品邻近方向；不能继续说生活记忆闭环没有公开实现。

它已覆盖我们许多基础工程目标，不应把流式采集、短/长期记忆、事件组织、带证据找物和自然语言回答重新包装成未覆盖方向。但还没有证据证明它解决带不确定性的IMU空间推理、可靠地点拓扑/路径指路或真实视障多日可用性。

## 来源与身份

- [LightMem-Ego全文v1](https://arxiv.org/html/2607.11487v1)，2026-07-13；Yijun Chen、Boyi Xiao、Yixian Zhao、Haoting Xia、Buqiang Xu、Jizhan Fang、Yanya Li、Yaqi Zheng、Xuehai Wang、Zirui Xue、Liuxin Zhang、Hui Li、Ningyu Zhang。
- [官方代码](https://github.com/zjunlp/LightMem-Ego)，源码MIT；模型、云服务及其他依赖各自许可。仓库包含后端、web、Rokid Android与离线research，不是占位README。
- 当前仓库长期引擎指向另一篇[EM²Mem](https://arxiv.org/abs/2609.00551)；README明确其EMNLP2026 Findings身份。不可把EM²Mem的离线benchmark成绩、当前代码与7月LightMem-Ego论文混成同一实验。
- [固定源码根目录](https://github.com/zjunlp/LightMem-Ego/tree/3c023dfec301bb2f9624f82cee76007ac3ac0646)。临时只读浅克隆位于批准目录`lightmem-ego-audit/`，不纳入本项目依赖。

## 1. 输入和真实链路

```text
手机浏览器 / Rokid眼镜
  → 带时间戳的RGB帧＋短音频
  → M_cur近期缓冲
  → 帧差/时间驱动micro-events → ASR补写/视觉描述refine
  → M_st短期事件
  → 异步consolidation → M_lt episodic＋semantic
  → query router选择层级/检索路径
  → 文本/原图/转录证据打包
  → 模型自然语言回答＋时间证据
```

原始IMU：**Unclear/未核实实现**。论文§3.1说接口可扩展轻量sensor cues，这不是已实现惯性接收/预积分/融合的证据。在本次稀疏检出的后端Python中搜索`imu/odometry/relocaliz/traversab/gyroscope`无命中；不是全仓库/全部客户端的穷尽证明。

## 2. 实际代码证据

以下路径均相对`src/backend/`，行号仅对应固定commit。

|模块|证据|能说明什么/不能说明什么|
|---|---|---|
|微事件构建|`online_short_term/frame_stream_event_builder.py:26–45,57–85`|帧差检测器、默认1–10秒微事件、最多8keyframes；闭合事件写MST并排refine任务。事件切分不是地点边界检测|
|短期转长期文档|`online_short_term/mst_to_episodic.py:26–59,62–101`|按时间窗episode ID、版本/替换、caption/transcript/scene/state_changes/visual_objects/keyframes/source_micro_event_ids打包；不等于物理地图/对象稳定身份|
|记忆路由|`online_query/memory_router.py:106–159`|实际用关键词/规则识别recent/current/summary/entity等，默认长记忆；不能把dynamic routing自动说成VLM学习路由|
|原图回退与完整性|`online_query/query_engine.py:807–860`|partial/provisional memory时可附本地原图并标完整性；不是纯文字摘要回答，不能简单描述成caption-only|
|证据充分性|`online_query/evidence_sufficiency.py:10–68`及后续逻辑|存在位置/放置/近期问答的证据规则；该模块存在不代表其拒答质量已经验证|
|编辑与rollback|`online_memory_edit/service.py:67–89,138–150,211`|update/rollback、idempotency、baseVersion冲突与新版本；不能因论文说lifecycle初步就宣称当前代码无编辑，也不能将编辑API等同于自动空间纠错|

公开默认配置`EM2MEM_VISUAL_BACKEND=mock`关闭真实帧级视觉embedding匹配，主要依caption/transcript检索；查询路径仍可附原图给模型。若作对照需明确embedding配置，不能拿mock结构冒烟当完整视觉检索成绩。

## 3. 与我们目标的关系

|能力|核查判断|
|---|---|
|持续视觉/音频生活采集|Yes：流输入与worker实质实现；未本机运行|
|current/short/long分层|Yes：论文与代码均明确|
|找最后所见/历史问答|Yes：有物品找寻场景和实现链路；准确率不代表成熟可用|
|自然语言回答与证据|Yes：核心产品功能|
|长期语义/习惯|Yes：设计与模块支持；真实长时稳定性证据有限|
|跨session|当前README称已支持；本次未追完跨session检索/身份隔离调用链，Unclear其完整覆盖|
|地点识别/可导航拓扑|Unclear：event/semantic graph不是通行图，未核实路径维护|
|当前画面→有依据路线语言|Unclear：通用问答可能输出路线，但没有已核实的路径/朝向/连通性保障或相应专项成绩|
|IMU不确定性进入VLM|未确认；不能从metadata可扩展推断Yes|
|视障真实用户、多日生活评测|本轮未见对应报告；不能用眼镜demo/HUD显示代替|
|隐私/删除成熟度|No完整生产保证：论文明确尚不完善；当前编辑/rollback不等于原件/索引/缓存彻底删除|

## 4. 评测规模与版本差异：不能被“长期”名称误导

- 当前README补充在线系统评测为**5个生活视频、约45.7分钟、27个查询（每类9个）**，包括找物、会话回忆、生活总结。这是小规模原型评测，不是已公开的多日视障生活数据集。
- 找物R@1=22.2、R@3=66.7，人评答案55.6%；整体R@3=74.1、人评55.6%。需看找物单类，不能以总结类高分代替找物可用性。
- README roadmap仍列“发布端到端评测数据和复现脚本”；本轮未确认这5段视频/27题完整公开可下载。因此可借鉴其应用导向gold evidence标注法，不能立即把其私有测试当我们的主数据。
- 论文§5.4长期QA P50为phone14.87秒、glasses19.96秒；当前README为10.57/8.61秒。保留版本差异，不挑快的冒称论文成绩，也不自动解释成已验证优化收益。
- 当前README EM²Mem在EgoLifeQA/Ego-R1/Video-MME(L)的成绩属于**另一篇离线长期引擎研究**，不是27题在线产品成绩，更不是视障辅助成功率。

## 5. 对项目和数据计划的实际调整

1. **提升为第一优先级生活记忆参考/候选基线**：优先参考stream timeline、异步ASR/描述补写、M_cur/M_st/M_lt边界、查询路由、原图证据回退及版本编辑。CROSS等转为定位/空间机制局部参考。
2. 不整仓替换我们系统。先写模块对应表与许可/资源估算，复用设计或独立适配；不擅自启动Docker、公共demo上传、模型下载或服务。
3. 对照先聚焦共同能力：同一生活历史下“最后所见”、当前/过去分辨、对话澄清、引用与成本；我们继续Qwen API，必要时统一后端并明确是适配结果。
4. 数据采用“真实生活视频＋独立gold evidence＋应用问答”可从很小规模起步，而非先凑机器人任务；但补上其原型未充分证明的**真实多日、跨session、物品实例、多次移动、未拍到的变化、无答案请求、路线证据和目标用户可用性**。
5. 产品差异应是可验证需求：向非视觉用户可理解地解释最后所见位置与路线、区分过期/未知、可访问交互、用户纠正及隐私，而非只换一个系统名字或增加IMU。
6. IMU是否有价值应限定在朝向、地点关联和路线消歧等问题实测；若只是历史对话或物品语义检索，不预设惯性一定有益。

**结论：它不是“和我们差一点的机器人导航论文”，而是应正面参考的生活记忆系统。基础闭环已有先例，我们要做的是把目标用户、空间使用能力和长期可靠性真正落到产品与数据上。**
