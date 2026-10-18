# 三组记忆对比：两个对照、一个实验

用户要求：Full memory与Memory oracle为两个对照，真实空间记忆算法为实验。旧current-only/recent-5min/full-history记录检索基线只作为历史附页，不混入这三组命名。

|组|角色|输入|状态来源|
|---|---|---|---|
|full-memory|完整输入对照|截至提问时全部原始三摄图像与因果可见逐观察空间判断，不检索/筛选/摘要|`run/school-spatial-oracle-v1/full-memory/manifest.json`|
|memory-oracle|理想证据对照|直接提供充分参考原图与ID，不提供答案|`run/school-spatial-oracle-v1/memory-oracle/`|
|spatial-memory|算法实验|实际空间库＋SpatialRetriever检索并查看证据|`run/school-spatial-oracle-v1/spatial-memory/`|

## Full memory输入已准备，但尚不能执行完整组

`sim/prepare_full_memory_evaluation.py`只读取公开问题、公开观察以及算法数据库，不读取私有答案/参考证据。90题分别生成完整因果输入清单及hash，保留所有应可见原图与模型判断。当前观察包含一次，不重复作为历史帧；尚不可用的联合窗口判断屏蔽，不使用含未来信息的最终地点摘要。输入是从现有记忆接口可因果恢复的原图＋逐观察判断；不是把整个最终SQLite直接泄露给过去时刻的问题。

审计结果：每题3至2553张原图；估算base64请求体最大2264.2MiB（约2.2GiB）。按显式配置的单请求安全范围（256图、120000输入token规划预留、64MiB载荷），86/90题被标为blocked。这里token按512/图＋文字UTF-8字节数＋4096预留，是规划估计，非端点实际tokenizer计数；上述范围是本次安全配置，不声称为供应商已核实硬限制。

因此full-memory当前**仅完成准备与容量检查，尚无付费调用、预测或成绩**。不只挑4道可放入题目冒充完整90题，不把86道未执行计为模型0分，也不截断或摘要后宣称完整输入。严格三组最终成绩单尚未齐全。应先核实端点图像数量、载荷与上下文支持，才决定大输入测试是否可执行；若改用全文本记忆，必须另命名并公开遗漏原图信息，不能替代本组。

## 解释规则

Oracle设计上应接近上限。若显著低于full memory，应排查参考证据是否充分、组织是否合理、回答协议和判分是否出错，而非自动认为空间算法有问题。小规模随机波动不等于逻辑上不可能；不以强行抬分确保排序。三组统一报告当前/短期/长期；已有空间/oracle执行结果不因新增full组被删改。

准备命令：

```powershell
python sim/prepare_full_memory_evaluation.py run/school-spatial-oracle-v1/spatial-memory run/school-spatial-oracle-v1/full-memory
python -m unittest discover -s sim -p test_full_memory_evaluation.py
```
