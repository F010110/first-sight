# 模型后端核查与现代VLM控制

来源范围：当前固定上游源码／配置，不将README或当前默认配置直接视为所有论文表格的实际模型；论文逐表对应仍需核查。

## 已确认的代码

| 方法 | 角色 | 源码与默认值 |
|---|---|---|
| 3D-Mem | A-EQA／GOAT VLM请求 | src/eval_utils_gpt_aeqa.py:48、eval_utils_gpt_goatbench.py:48 均请求 gpt-4o |
| 3D-Mem | 其他ConceptGraph工具 | src/conceptgraph/utils/vlm.py:103 为 gpt-4o-2024-05-13；不能默认这些工具全在主评测调用链上 |
| 3D-Mem | 检测／分割／特征 | 官方评测入口YOLO-World、SAM、CLIP ViT-B-32；与问答VLM角色不同 |
| GraphEQA | Habitat默认规划后端 | cfg/grapheqa_habitat.yaml:39 为 gpt-4o-2024-08-06；其他配置存在Llama-4-Maverick，不把当前仓库后增配置当作原论文模型 |
| Meta-Memory | 历史描述 | scripts/preprocess_captions.py:58 为 Qwen2.5-VL-7B-Instruct |
| Meta-Memory | 工具检索与推理 | agents/metamemory_agent.py:101–102、memory/milvus_memory.py:188/413 为 gpt-4o |
| Meta-Memory | 向量特征 | mixedbread-ai/mxbai-embed-large-v1；不是问答模型 |
| FindingDory | 当前官方Qwen配置 | findingdory/config/baseline/qwen_imagenav.yaml:15 为 Qwen2.5-VL-7B-Instruct；论文还比较GPT-4o、Gemini等及SFT，不概括成仅小模型 |

## 本实验约束

1. 不因API不提供历史7B模型而换成随意的本地小模型；默认统一使用已验证的qwen3.8-flash。
2. 配置记录请求ID、返回模型ID、是否固定版本、推理模式、temperature、图像分辨率、最大输出、调用及输入预算。Flash名称或新版本不证明对所有空间题更强。
3. 区分原算法／原模型复现与“原记忆方法＋统一API后端适配”；后者为当前主实验。若旧模型不可用，明确不可用，不虚称复现原表格。
4. 完整方法基准通过后，用统一API做GT位姿与物理误差组配对，不将后端提升归因于记忆算法。
5. 增加同后端的直接历史图像／简单视觉检索对照：相同可见证据和预算，不能直接给答案或问题后的观察。若纯VLM已能回答，报告结构化记忆在此问题上的增益有限。
6. 闭环探索中先固定共同历史作推理对照；不同策略采集历史的端到端对比另列，不能把两个不同证据池称等输入。
7. 预算允许时选第二个经验证的较强多模态API后端作子集复核；未核查价格、可用性和预算前不自动发起批量调用，也不假定flash就是能力上界。
8. 答案评分后端单列；不能让同一模型的自评作为唯一证据。优先保留官方适用评分协议及盲法人工复核，报告原始问答与逐题分数。

## 对旧诊断的影响

此前对象关联诊断没有调用问答API，所以不能据它判断现代VLM最终是否会丢分。并且该脚本缺少完整融合，已有更正。新的端到端测试要同时报告内部表示、证据召回和最终分数，允许出现“内部改变但现代VLM得分不变”。
