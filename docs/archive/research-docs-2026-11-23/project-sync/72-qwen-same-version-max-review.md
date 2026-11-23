# 用户纠正：强裁判仅指同版本Qwen Max

用户明确弱模型为Flash，强模型为同版本Max，不需要GPT/Gemini或更强外部模型。之前扩展到其他模型家族是对需求的误解；其区域、额度、密钥阻塞不再作为当前任务前提。

已从现有QWEN_BASE_URL的模型目录确认同时存在`qwen3.8-flash`、`qwen3.8-max`和`qwen3.8-max-0902`。本次固定裁判为`qwen3.8-max-0902`，生成模型保持Flash，绝不重跑已有60时刻输出。

入口现在默认Qwen Max，也可显式：

```powershell
node dist/current/sim/evaluation/review-spatial-ensemble.js run/unioncity-spatial-pipeline-continuous60-v1 run/unioncity-spatial-qwen-max-review-v1 --confirm-paid --qwen-max
```

只用QWEN_API_KEY/QWEN_BASE_URL。裁判适配器拒绝将Flash或其他模型家族放入Qwen评分lane。与生产spatialJsonVlm分离，不改生产模型、价格估算或旧账本。

保留机制：固定事实ID、完整检查覆盖、图像证据、六个正反例门控、两次盲审、争议第三次复核、有限格式重试、未评/争议/无法核实分离。两次Max请求对事实和图片采用相反顺序，第二次优先核查支持证据与合理替代解释，降低重复同一上下文的机械复述。它们仍是同模型同家族，不能当统计独立样本或跨家族共识；6个控制通过也不是人工金标准认证。

新输出目录`run/unioncity-spatial-qwen-max-review-v1/`；实际调用成功与否由校准图片请求验证，不再以模型目录200当评分成功。完成后主动报告实际确认失分和未测能力，保留以前所有失败尝试和评分。

针对性测试4/4通过，覆盖同版本Max路由、禁止Flash评分、并行请求隔离、事实ID与争议处理。
