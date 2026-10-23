# 保守graph试验结论：停止，固定sequence（2026-10-23）

## 决策

停止本批后续运行，不恢复、不补跑；当前工程路线固定sequence（方法2）。保留graph实验代码与全部失败／中断证据，但不进入默认系统，也不继续追加图提示实验。

这是当前预算和证据下的工程取舍，**不是证明图方法普遍无效，也不是准确率结论**。预注册要求三轮完整且覆盖／最差轮／稳定性不低于sequence，本批已不满足。

## 实际状态

检查时没有匹配`run-spatial-repeat-batch`或`run-spatial-fixed-evaluation`的Node进程。保存的status.json不是最终完整状态，仍保留round-2-sequence为running；原文件不改写，以下单独核对日志和落盘usage：

|试验|实际已提交观察／33|unknown|组数|调用|估算USD|
|---|---:|---:|---:|---:|---:|
|round-1-sequence，完整|33|0|5|199|0.1579364256|
|round-1-guarded graph，完整|33|1|4|204|0.1630559640|
|round-2-guarded graph，失败|7|0（仅已提交前缀）|1（前缀）|24|0.0149539164|
|round-2-sequence，中断|18|2（仅已提交前缀）|5（前缀）|88|0.0923877336|
|round-3两方法|未启动|不适用|不适用|0|0|

后两条前缀不能拿来和完整33观察算方法平均覆盖，也不能把pending当成视觉unknown。第二轮graph错误为`Place scope needs a fixed name, concrete definition, boundaryRules and every seed original.`，属于scope协议验证失败，不是证据表明图边造成空间错判。第二轮sequence没有进程也没有正常结束证据，按中断保留，不能臆测中断根因。

status.json估算仅USD0.335946306，漏掉未归档到批次状态的在途sequence。计入其落盘usage后，合计**USD0.4283340396**，其中sequence有**2个未知调用预留**，已含在合计内，不清零、不声称实际账单已结算。无新增VLM调用。

## 改进是否有效

完整第一对照轮：sequence覆盖33/33=100%，guarded graph为32/33=96.97%；费用graph高约3.24%，调用204对199。成本门槛未超，但覆盖未胜出，且无法形成完整三重复稳定性结果。graph组更少（4对5）不是准确性证据。

第一轮guarded graph身份请求累计交付88条关系记录（含同一边在多次请求中重复交付，**不是88条不同边**），说明过滤后并非始终空图；第二轮失败前交付0条。因此不能把第二轮协议失败归罪于图关系。当前只能认定：保守过滤未展示足以替代sequence的稳定工程收益，且整个试验可靠性未达到预注册要求。

## 后续边界

沿用此前9轮工程评分的sequence默认，不改硬件／实时默认。下一阶段优先独立真值评分、完整原图消歧容量和重复组修订，而不是追加图关系。将来若有新的场景、独立真值或明确需求，可另立实验；不隐式恢复本批。

原记录：`run/spatial-repeat-batches/campus-guarded-graph-20261023-v1`。中断sequence根目录由`round-2-sequence.log`定位到`run/spatial-fixed-evaluation/2026-10-23T05-20-59-627Z-8b94270d`，其usage预留不得遗漏。
