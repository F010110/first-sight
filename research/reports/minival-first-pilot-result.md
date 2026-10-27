# minival完整流程首题

状态：首题执行退出0，尚未自动答案评分。

- 官方题目ID：025257b6-8b7e-4f6f-aacc-1788069cbfad。
- 问题：Which bin should I put paper in?
- 官方参考：The bin with the yellow lid.
- 模型回答：You should put paper in the blue bin (the recycling bin).
- 观察：答案中的关键定位属性不一致，不能视为答对；需官方评分协议或人工复核给出正式分数。
- 原生过程实际运行了检测、对象融合、去噪／合并、快照、探索和API回答；50步上限配置保留，3步完成，11帧，最终5个快照。
- 上游日志Success rate 1/1代表运行成功并选到目标，不是答案正确率。禁止将其报告为100%问答准确率。

评分工具已获取到vendor/3dmem-aeqa-eval。其evaluate-predictions.py:65–78会去掉空答案并限制为已回答问题，直接采用会漏算失败题。正式子集汇总必须固定26题分母，执行失败／空答案按预注册规则计0，另列有效回答条件分数。

本次日志出现httpx打印API端点地址（不含密钥）；后续已关闭httpx/httpcore INFO日志，SDK自动重试设为0，并增加模型及usage记账。不公开既有原始日志中的端点；旧原始日志本地保留。

下一步：接入评分提示和固定分母的汇总；小样确认后跑26题GT基准，再做真实传感器误差配对，不用简化关联数字充当任务结论。
