# HSSD：VLM局部地点组织实验

按用户要求先不回归家庭、暂停分组阈值调优。仅HSSD原5有效采集，计划第6输入失败保留。不是发布默认方案；不改原图、生产RequestAgent或既有预测。

`sim/hssd_place_organization_trial.py`已后台启动。新目录`run/hssd-place-organization-<timestamp>/`，原响应/提示/图片哈希/协议反馈、首次有效答案、延迟、失败均保存。模型qwen3.8-flash，temperature0、timeout240、SDK retries0、最多2协议修复。可显式`--resume <directory>`复用原hash/prompt一致的有效答案，不为选分数重复覆盖。

## 第一轮组织迭代

1. 每8图请求单观察局部锚点，覆盖全40/38/40/40/23观察。允许功能未知或房间scope未知，要求至少两项可见实例/结构和观察者侧依据；看不清就unknown。不是逐图自动生成一个独立房间。
2. 每例预先冻结8对：6个分布在路线不同位置的相邻对、首末及一对远距对。远距对是候选而非预知回访。两种arm使用完全相同目标，direct只给目标图，context另给两目标各前后一个观察；时间仅原timestamp，不代表跨门。
3. 关系与区域分离：same-local-place/different-local-place/connected/unknown；physicalScope另判same-region/different-region/unknown；boundary判interior/threshold/unknown。走廊不是整个boundary，功能名字不是身份，透门家具不是所在侧。所有same-local-place需要引用两个实际目标。
4. 模型先推理，标签后读，仅对physicalScope做既有暂定标签一致诊断；**房间标签不能验证局部地点相同**。未知不是错误身份，也不能靠每图分配一个ID宣布地点识别成功。没有导航许可、不强制用传递闭包合并。

正常总105次请求（25锚点batch＋80关系arm），加协议修复有硬上限315，不无限搜索prompt。首次跨场景对照完成后，检查direct/context哪个补充了真实证据、哪个过度推断；用实际冲突再决定下一轮组织，不从AI标签泄露房间数/目标答案。

Python90/90通过，包括pair预算/目标覆盖、same必须双目标证据、anchor实例数与编号覆盖。当前只是实现并开始研究，不宣称已复认地点，也未宣布VLM对空间划分可靠。
