# 2026-10-17 本地实跑补充

本文件只记录已执行内容，不表示R1–R14验收完成。

- SALAD：`run/tartanground-school-salad-v5`完成90组270图，CPU4线程214.16秒，8448维。精确历史代理端点top1=5/14、top2=8/14；RGB为3/14、3/14。非物理地点准确率，非独立测试。v2/v3依赖失败、v4超时82组保留。
- SALAD缓存：`run/tartanground-school-salad-cache-v1/recall-acceptance.json`验证62个原预测观察索引及有界top2查询，9815ms；不修复原错误身份，0云端请求。
- AnyLoc：`run/tartanground-school-anyloc-v2`完成270图。官方demo，vitb14第11层token，8中心VLAD6144维，仅前8观察拟合词表；非论文默认配置。top1=4/14、top2=8/14。warmup结束之前不得解释为因果在线结果，独立负例仍缺。v1缺psutil失败保留。
- DISK/LightGlue：`run/tartanground-school-lightglue-v1`，6个指定历史观察对，每对9视角组合，512关键点上限；保存对应点、F-RANSAC内点及权重hash。不以匹配判定同房间；指定案例不是完整负例验收。
- 多样性：`run/tartanground-school-diverse-evidence-v1`官方DirectMe KeyframeSelector，最后16候选/4观察/12图上限，JSON恢复重算一致。未接修订生命周期，不声称胜过首尾基线。
- 身份复核：新增独立wrapper及可选不可信初判提示；仅新建时第二决策，非法ID/异常拒绝提交，原输入复制。build与1 TS测试通过。未接付费调度预算，未付费复跑，不代表R6完成。
- DirectMe官方toy实际执行：events=2 nodes=2；使用作者toy几何/物体，非学校RGB预测结果，不能作为R9完整基线。
- SuperMemory：固定revision `1d228e0f10049a8a84c458dded2aa25b1e21ce8f`的公开all_qa.json，SHA256 `fbb3f234d8ce79e5cfbe31482d735038035ee13f59a6468a3f3a078c2aa15663`，4853题。请求与答案/证据注释分离，完整预测覆盖校验、QA准确率/answerability F1实现；1 Python测试通过。没有视频记忆输入、真实预测或官方复现成绩；因果问题时钟仍待核实。

## 未完成及外部准入

R7/R8尚未接入EgoRAG/Video-RAG；真实音频/转写不存在时不可生成假模态。MeMoREval已取公开任务，但官方完整执行/记忆/评分实现仍未发布。EgoMonth数据接口返回401，未绕过身份或同意条款。没有合格真实日尺度校园轨迹、独立相似负例或核实端点价格，不启动长测。上述条件阻止完整R9–R14效果验收；不能用接口、toy或同一路线重放替代。
