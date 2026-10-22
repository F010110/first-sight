# 校园三方法各三遍后台重复实验

用户允许在当前片段重复或扩大规模；本批选择先在当前完整33观察片段重复，避免全校园全成员比较调用量增长造成难以解释的截断。不是全校园90轮，也不宣称覆盖10段录制。

- 新独立空库轮次9个，3方法×3重复，不复用先前三轮预测。
- 每轮同一公开输入、同一RGB描述、模型、感知／scope／全成员规则、短引用；仅三个预设方法的访问上下文不同。方法2仍是用户选择的固定方法，另外两者为明确实验。
- 串行轮换方法顺序，减少把服务时间段变化完全混入方法差异；不是相同HTTP字节实验，因为上游随机结果／runtime UUID会使后续上下文不同。
- 各轮最多256请求，估算USD0.50；整批最多USD4.50。每轮前预留0.50预算，不并发；保留原provider的有限传输重试，不自动重启整轮或拼接成功结果。
- 保留plan／状态／各轮命令和stdout+stderr日志／子运行路径。protocol失败单独failed后允许下个独立计划轮；未知计费／缺收据／预算或冻结文件改变则整批停止。
- 原始TS、编译JS、批次脚本、输入及描述文件hash冻结。转做硬件不要改动空间推理文件；若修改将于下一轮启动前停止，不能偷偷混版本。
- complete.json表示所有计划轮已尝试，不表示每轮成功或空间准确；failed／pending不得从结果分母消失。服务重启不可自动续接，先人工核对状态和计费。

启动命令：

```powershell
node scripts/run-spatial-repeat-batch.mjs run/spatial-repeat-batches/campus-episode6-3methods-3repeats-2026-10-22-v1 run/spatial-evaluation-inputs/campus-episode6-first64s-current-v1/public.json run/spatial-evaluation-inputs/campus-episode6-first64s-current-v1/features.rgb-v1.json --confirm-paid
```

该目录已建立并确认round-1-recall为running；不可重复执行上述同名命令，脚本也会拒绝覆盖已有目录。后台工具shell ID写入TODO。当前不等待结果，不更换前端回放、不自动推广任何方法。完成后分别汇总各方法完整三轮和所有失败、覆盖／unknown、配对稳定性、组数、费用、请求数／可获得的延迟；没有独立真值仍不能把稳定性称为空间准确率。
