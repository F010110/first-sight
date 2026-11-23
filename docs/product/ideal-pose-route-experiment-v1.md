# 理想位姿—序列经历—VLM路线实验 v1

本实验独立于固定方法2，不接网页、不修改其算法或数据库。面向视障路线记忆设计；当前仅生成**历史路线回顾**，不是可直接使用的实时导航。没有启动付费调用，没有新增数据集。

## 旧图/序列实验到底说明了什么

依据 `spatial-method2-fixed-and-graph-diagnosis-v1.md` 与 `spatial-candidate-recall-and-topology-v1.md`：两组都保留访问序列，graph只是增加结构化关系表，不是图片形式的图。最早6秒分歧时关系表均为空；30秒分页判断矛盾产生重复候选，12个unknown里11个来自程序图片预算保护。早期随机感知/归属又改变后续上下文。因此不能证明图结构必然更差，更不能确认是模型阅读图形能力差。暂用序列作为权威经历，图以后作为可重建索引，不把模型派生边当独立证据。

## 设计及范围

- `src/agent/route-experience-experiment.ts`：独立序列内存、理想位姿粗化、地点提议门禁、历史正向路线说明。
- `src/route-experience-experiment.ts`：独立离线/显式付费命令、图片hash校验、逐步不可覆盖checkpoint、请求响应归档、失败停止。
- 原始序列保存图像及理想位姿用于审计，但模型只收到少量原图、地点候选、时序和粗运动。
- 约定XY米制同一坐标系、yaw弧度逆时针为正，yaw表示相机朝向。跨frame拒绝。来源强制 `ideal_pose_experiment`，不冒充IMU或生产定位，也不沿用“GT不得进运行时”的正式验收口径：这是显式特权输入实验，不报告无oracle导航成绩。
- 端点位移 `<0.2 / <2 / <8 / >=8m` 分为stationary/short/medium/long；净yaw `<25° / >150° / 其余符号` 分为straight/reverse/left/right。这些只是可复现的初始分档，不是标定或人体动作真值；stationary也仅指端点接近，不能证明期间未移动。折返、绕圈、途中转弯可能抵消；v1不恢复完整路径，不报步数/距离，不声称粗摘要保留所有运动信息。输入采样需足够密；质量/采样密度未验收。
- 当前最多3图，最近2条＋较早1条anchor，合计最多12张图。anchor暂为最近较早已命名观察，不是视觉检索器；候选召回能力有限。VLM可以new/same/uncertain；same需引用相应历史图；精确坐标不直接决定身份。命名节点均为模型候选，不标成已确认事实。
- 不画图给VLM、不检查所有历史成员、不训练编码器。先用现成Qwen API的结构化JSON＋图片，只有证明表达能力不足、具备标注与评测后才讨论微调，当前没有训练流程。
- 路线限制为2..4条连续已分配身份的真实记录，按正向生成，全部原图交付；不自动反转、不跨unknown、不拼接最短路。第一条motion不引用片段外经历。输出带证据ID和“历史路线未验证可实时使用”状态。引用门禁不保证描述语义正确，安全约束目前是提示和状态标签，不能用于独立视障出行。
- CLI按序调用，不支持同一实例并发observe。失败不更新内存；逐步checkpoint保留。CLI重新构造对象验证snapshot恢复，不宣称真实跨进程恢复或SQLite事务验收。

## 输入与运行

先 `npm.cmd run build`，再：

```powershell
node dist/current/route-experience-experiment.js INPUT.json NEW-OUTPUT
```

默认零网络，必须显式提供 `responses`（stub，仅接口测试）。需要真实模型时另行授权执行，增加 `--confirm-paid`，使用既有Qwen配置、最多24次调用/USD0.50估算；失败停止，无自动协议修复或续跑。此入口不会自动读取任何现有GT或地图。

输入示意（图片路径和SHA256必须替换成已有原图的真实值；不是现成可跑数据）：

```json
{
  "schema": "ideal-pose-route-experiment-v1",
  "observations": [
    {"id":"o0","atMs":0,"images":[{"id":"o0","direction":"front","path":"EXISTING.png","sha256":"REAL_SHA256"}],"pose":{"x":0,"y":0,"yaw":0,"frameId":"local","source":"ideal_pose_experiment"}}
  ],
  "responses":[{"decision":"new","placeId":null,"description":"仅用于测试的地点描述","sourceIds":["o0"]}]
}
```

可选 `route:{"from":"o0","to":"o3"}`；离线responses按每次观察＋最后一次路线说明排列，路线回复为 `description/sourceIds`。至少1最多20条观察。manifest明确privilegedPose和scripted-not-vlm；原图hash验证、memory-N、request-N、response-N、complete/stopped都独立保留。

## 尚未实现

长路线分段生成、转向事件序列、显式记录间隙/连续通行核验、自动图索引、跨片段候选检索、节点合并撤回、用户确认、当前位置/身体朝向校验、实时避障、真实IMU接入、独立语义评测和真实进程重启测试。以上不能因本实验构建通过而宣称完成。
