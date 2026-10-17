# 完整活动样本与用户问题评分 v1

## 目标与交付边界

用户最新要求优先：构造若干完整活动样本，通常含室内外过程、足够长的有效观察；允许真实或模拟的分段日程、合理摄像头关闭空档。24小时中移动2–3小时是可选规模示例，不是要把现有短片拉伸成24小时。分开报告实际视觉时长、模拟活动日程跨度、独立源轨迹数量。禁止重复同一帧/倒放/改变播放速度刷有效时长；不同地点之间可以有明确未记录的通勤，不伪造连通走廊。

先构造至少3个各≥20分钟实际视觉输入的分段活动样本（可按真实来源情况调整，但不能称2小时样本）；后续扩展至2–3小时移动日。每段保留源时钟，活动日程时钟明确为合成。题目只依赖摄像头实际看见的内容：关机期间即使模拟器知道对象移动，也不能作为可回答证据。

## D1 候选空间与数据调查（官方来源，2026-10-17）

| 路线 | 官方核验 | 用途与限制 |
|---|---|---|
| TartanGround | https://tartanair.org/tartanground/ ，https://huggingface.co/datasets/theairlabcmu/TartanGround | 63环境/878轨迹，10Hz、640×640、多向相机；可立即提取多环境完整轨迹。机器人视角非真人眼动，不含可编辑日常对象变化；先下载6环境metadata统计实际时长，再选图像，不能根据场景名断言室内外。 |
| Mind Palace LA-EQA | https://github.com/mind-palace-laeqa/benchmark ，https://arxiv.org/html/2507.12846v2 | 官方150题、多episode、5–10场景状态版本；论文真实轨迹30–60分钟。repo公开题和约6GB场景下载入口，不等于所有30–60分钟原轨迹已可直接取用。复用跨时刻问题设计，需检查实际文件/许可。 |
| uHumans2 / TESSE | https://www.mit.edu/~arosinol/datasets/uHumans2/ ，https://github.com/MIT-TESSE/tesse-core | 办公室/公寓/地铁/社区、动态人、原始ROS bag；00h/24h等是人数而非录制小时，官方各动态版本复用同一轨迹，不能算独立路线。原生双目，不伪造三向相机。 |
| SPEAR / Unreal | https://github.com/spear-sim/spear ，https://mikeroberts3000.github.io/papers/spear/ | 可控室内场景、CitySample/PCG与光照控制，适合后续自定义活动、对象变化与多人动态。代码许可证不自动覆盖Epic/第三方内容；尚未在本机证明UE场景可运行，不当已经取得的长样本。 |
| ProcTHOR / MansionWorld | https://procthor.allenai.org/ ，https://github.com/AgibotGeneral/MANSION | 可编辑对象状态/多层公共建筑，适合作为受控变化支线。MANSION跨层API实为卸载/加载楼层，需记录切换；当前资产/室外问题不应阻止采用其他来源。 |
| OpenEQA | https://open-eqa.github.io/ | 学习开放用户问题与人工/LLM语义分级评判；180+环境不等于180个长时活动日，不能自动补足室外。 |
| Ego4D / EPIC-KITCHENS | https://ego4d-data.org/docs/start-here/ ，https://epic-kitchens.github.io/ | 前者真实移动/找物问题，需用户自己签署许可，不能代签；后者100小时厨房活动适合状态记忆，但不是室内外整日连续录制。单列后续真实视角外部验证，不阻塞公开模拟源。 |

实际操作：`sim/survey_activity_sources.py`在D盘按HF固定revision/源hash下载AbandonedSchool、Hospital、ModularNeighborhoodIntExt、OldTownSummer、Office、Supermarket的metadata和数据卡；独立统计轨迹时长与下载量。先检查源，再决定哪些能构成主样本。代码/网页公开不代表许可允许任何用途；条款保存，不绕过身份审批。

本地保存的TartanGround数据卡明确声明CC BY 4.0（frontmatter及License节），不是仅凭公开下载推断授权。包装保留作者、来源、固定revision、许可链接与修改说明；不把数据卡中明显占位的Metadata Sheet链接作为依据。

## D2 样本协议

- **独立单位是活动样本，不是图片对**：一天或半天的若干移动episode，带目的、关机时段、重访、相似房间干扰；原始机器人随机游走仅可称“活动路线代理”，不能冒称真人执行任务。
- 每段source hash与源时间不变；日程时间单调、有显式gap；不推断空档里的路线、位置或对象状态。不同世界以不同world instance保存，跨世界衔接标成未记录的交通，不宣称物理连通。
- 模型包只给图像、时间、普通用户问题；源环境名、GT位姿、房间/楼层ID、任务类型、证据位置、答案与评分放evaluation-only。模型图像ID使用不含语义的稳定散列。
- 定义建筑→楼层→功能区域→具体实例层级及边界容忍带，但**不要求预测UUID等于标注UUID**。相同房间被拆成多点，只要任务答案/证据正确就不直接扣分。
- 样本按完整环境划分开发/保留集，同建筑跨日/不同轨迹不能分散进两边；同一视觉素材不能在一个样本中重复充当新的观察。
- 问题包含找回事实、最后一次见到、路径/顺序、相似地点区分、状态变化、信息不足。每个答案必须有可见证据；没有变化素材时不编对象移动题，样本不得假装支持该能力。
- 发布前由逐段contact sheet与任务证据卡复核；AI初标与独立人工复核状态分开。未完成证据复核的样本可用于工程开发，但不输出正式系统成绩。

## D3 最终成绩单：三张卡，而非一个总分或指标清单

1. **实际问题解决（0–100）**：用户能否据回答完成目标。固定问题类别权重，先在每个活动样本内汇总，再按样本等权。正确且证据有效=1；仅完成非关键子目标=0.5；错误、猜中但无证据、可答却拒答=0。信息不足时明确拒答=1。遗漏问题视为拒答，不从分母删除。
2. **长程与干扰（0–100）**：同一任务评价规则，限定到长间隔重访、相似空间/跨层干扰、跨episode或已观察状态变化的任务组；按挑战类型再按样本等权。某必要类型没有合格任务时显示“未测”，不拿空集算满分。这一层衡量真实复杂问题，不用节点数量/边界精度替代。
3. **回答可信（0–100）**：问题后果分级扣分后汇总。会把用户带到错误地点、把旧状态当现在、混淆楼层/实例、捏造不可知事实、引用未来信息等重大错误扣1；不改变行动的附带事实错误扣0.25；正确或明确不确定扣0。评分不是根据模型自报confidence。全部拒答可能可信高，但实际问题解决低，不能靠拒答刷总体“好用”。

类别权重为v1产品假设，冻结在预测前：事实回忆20%、最后见到20%、比较区分15%、过程顺序15%、状态变化15%、未知/过时15%。每类任务配额不足时成绩“未测/未就绪”，不把剩余类重新归一化刷分。不以“六类率”占据最终报告；类别明细只在下钻审计里。

**误合并不是机械处罚项**：只有导致错误答案、错误证据归属或误导性断言才影响用户分；在真实任务中暂未产生影响的潜在误合并留内部风险诊断。同理，误拆分/门口边界不同但答案与有效证据不变，成绩不变。不能仅凭相关性声称“此错误由误合并导致”，因果归因须另做反事实消融。

### 如何判分

答案语义由独立评判记录，不读取模型自己的“答对了”字段。支持结构化精确答案/别名；自由文本采用冻结量表、盲评，争议复审。LLM judge可辅助，不作为无复核的绝对GT。答案与证据分别检查：引用必须是执行器实际inspect过的、在问题时刻之前、属于允许录制范围的原图；错误楼层但同色墙面不算正确证据。正确答案且引用错误也不算解决任务。

评分输入包含题目/私有真值、原始回答、可信执行器的inspect日志、绑定回答hash的评判记录。覆盖率、Recall@K、分组误拆/误并、门控率、延迟、成本均放内部诊断或单独运行账单，**不进入三张最终分卡**。

## D4 验收底线

本地执行（评分与源打包只需Python标准库；复核图需要`sim/requirements-activity-review.txt`，建议隔离venv）：

```powershell
python -m pip install -r sim/requirements-activity-review.txt
python -m unittest discover -s sim -p "test_activity*.py"
python sim/build_activity_samples.py D:\Datasets\activity-benchmark-v1\rgb-sources-v1 D:\Datasets\activity-benchmark-v1\samples-v1 --auxiliary D:\Datasets\activity-benchmark-v1\auxiliary-city-walk-v1
python sim/review_activity_samples.py D:\Datasets\activity-benchmark-v1\samples-v1\community-shopping D:\Datasets\activity-benchmark-v1\review-v1\community-shopping
```

打包入口只有全部源下载完成且逐zip hash通过才运行；输出不可覆盖。复核默认每约20秒取一组并保留episode首尾；稀疏图只用于筛查，逐观察标注可用`--stride 1`，不得把默认图册当全量审核。

必须用自动测试证明：UUID重命名/无害拆分不影响分数；错房间即使物体类别相同也不能满分；过时/未来证据拒绝；全部拒答不能获得高实用分；缺预测不被删除；缺类别/未审核标注不得发布成绩。评分夹具和“全部拒答”基线只能验证评分器，不能冒称实际空间记忆系统成绩。
