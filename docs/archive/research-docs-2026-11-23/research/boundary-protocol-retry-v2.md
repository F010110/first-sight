# 输出协议纠错重试v2

用户人工审查：val5观察27明确位于浴室内部，旋转时透门看到卧室，不是边界；模型边界标记是错误。34刚离开浴室、主体已在卧室内但紧邻门口，边界表述可争议，不应与27作为同等明确误判。原AI核心标签及旧评分保留；该用户意见单独记录，不把34从分母移除来提高成绩。

`sim/vlm_boundary_group_trial.py --protocol-retries 2`新增独立`vlm-boundary-groups-retry-v2`运行，最多初次＋2次协议修复调用。原图保持在会话，传回具体校验错误，要求完整JSON及每组实际非边界引用；不能支持的组仍允许未知。第一份校验合格答复即停止，保存每次API回答、原文和失败记录。不加载评分标签来重试，不按准确率筛选，不把漏引用当作永久一次性失败。

重试耗尽后，仅缺引用问题按原规则隔离未知；其他不合法结果仍拒绝，不补造证据。网络/API错误不在此机制中自动重试，异常传播且已完成尝试保留。结构校验无法发现27这种语义误判，所以不能自动触发“标签不同就重试”。语义规则优化需新提示实验与独立验证。

冻结v1默认0次重试保持不变；使用新输出目录保存v2，旧val5响应/成绩不覆盖。离线两项模拟响应测试验证缺引用修复、第一合法停止、坏JSON次数上限；尚未付费实跑验证提升。

```powershell
python sim/test_boundary_protocol_retries.py
python sim/vlm_boundary_group_trial.py run/sim/vlm-boundary-val5-input-v1 run/sim/retrospective-repair-val5-v2.json docs/experiments/fixed-region-queries-val5-v1.json run/sim/vlm-boundary-val5-retry-v2 --protocol-retries 2
```
