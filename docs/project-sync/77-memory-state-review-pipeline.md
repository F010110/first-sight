# 位置标签驱动的空间记忆评审流水线

2026-11-02：主评审为同版本Qwen Max的灵活位置标签评审，硬指标辅助，人工审核独立保存。未建立关系不是已经判断错误；静态状态评审不能冒充主动检索测试。

## 已连接

- `memory-state-review.ts`：验证原813因果快照、源输入和位置标准绑定，准备不可变案例。裁判只额外拿到位置标签/派生关系，图片仍为原Agent可用来源。位置是观察者所在区域，不是全部可见区域。
- `run-memory-state-review.ts prepare STANDARD RUN NEW-BUNDLE`：零API准备813案例及审核包。
- `run-memory-state-review.ts judge BUNDLE --confirm-paid`：有界4并发、同版本 `qwen3.8-max-0902`，独立请求与用量记录；每例保留失败、禁止隐式覆盖或恢复。单轮模型评审，不虚称双审或人工确认。
- location / organization / history / calibration 独立0–4分；未执行为not-applicable，标准不足为standard-insufficient。精确原文引用与真实标准字段校验，不允许虚构引用。分母、失败、适用性覆盖单独报告，不输出掩盖缺项的总分。
- `annotation-review-server.ts` 的 `/memory.html`：标签与实际状态并排、三摄原图、裁判意见、筛选、实际JSON结构树。没有空间图就不伪造图。
- 人工认可/驳回/需核实沿用同源token、版本冲突检测和追加日志；评测包禁止改写标注字段，原始标注包仍保持不动。评测案例与策略hash进入审核包绑定。

## 本次准备结果

`run/unioncity-memory-review-v1/` 来自 `unioncity-realtime-full813-v2` 与 `unioncity-reviewed-position-freeze-v1`。审核网站 http://127.0.0.1:8894/memory.html 。准备不等于已完成付费裁判；没有裁判结果时页面明确显示待评审，不能认可/驳回不存在的裁判。

## 边界

本入口只评实际保存的状态，不调用空间Agent补答，也不启动用户问题。当前系统没有显式区域结构时，相应维度不适用，不得编造0分或满分。自主检索与成对关系能力需后续另建因果隔离的操作测试，不能由本次裁判推断。硬指标已有独立完整性/位置关系审计，不是主分。

运行产物、原图、数据库与用量记录仍在run目录保留，不提交大数据或凭据，不推送远端。
