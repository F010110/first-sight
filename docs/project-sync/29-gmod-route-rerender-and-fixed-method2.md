# 用户轨迹重渲染与固定方法2首次试跑

2026-10-30。用户授权沿已录制坐标生成样本并运行系统，同时询问版本。

## 实际生成

`first_sight_route_render.lua`部署后，安全启动UnionCity，按用户的脚底位置移动生成侧玩家以更新PVS，再用原眼睛位置和朝向离屏三摄渲染。逐点设置位置只是**新样本渲染机制，不是正常步行或动作复现**。没有重放E键；门/动态状态不保证与原体验相同，不能用它验证原开门成功。一个视点约源时间1秒，383组/1149张640×480 JPEG，52.83MB，全部解码检查通过，抽查见`run/gmod-route-rerender-v1/contact-sheet.jpg`。原时间覆盖405.55秒，非渲染耗时。

实际episode：`D:/SteamLibrary/steamapps/common/GarrysMod/garrysmod/data/first_sight/route_render_20261030_145136/`，summary completed；安全启动器1600×900，无OS输入，无残留进程。渲染上限500秒/128MiB，启动器540秒。原手动数据保留，新视频尚未发布。

## 版本与入口

包版本2.1.0，Git基线`5095d1e27b4ee9f9d3e1168d5bca0b43ef2253ba`，工作区大量未提交修改，因此不等于干净旧发布。本轮不修改记忆算法，源码hash在`run/gmod-route-rerender-v1/code-snapshot.json`，推理入口还保存`frozen.json`的实际依赖hash。

使用既有`scripts/evaluation/run-spatial-method2.mjs`：最近2地点＋视觉候选2地点＋最近6次访问序列，不给VLM图关系；qwen3.8-flash、不启用thinking、估算USD0.50/256调用上限。**这是固定空间记忆子系统，不是AssistantRuntime/QwenPlanner全流程，也不是所有产品能力的完整验收。** 不输入原生精确位姿；只有三摄、相对源时间、匿名scene-01，图像rgb-layout候选特征。没有引入坐标标签或未来答案。

## 实际试跑及停止

- 按源时间约2秒采样，共192观察/576图。
- 首次输入JPEG，被固定入口PNG验证在模型调用前拒绝，0观察完成。失败工件`run/gmod-route-method2-v1/`保留。旧scorer又因无usage文件失败，未改写为成功。
- JPEG解码后无缩放保存PNG，已有文件逐像素核对；本地转换30秒超时产生一个部分PNG，保留为`.interrupted.png`后重新生成该文件，不更改原图。重新计算输入hash和候选特征，独立新试跑。
- `npm run build`通过。新批次`run/gmod-route-method2-png-v1/`，实际推理目录`run/spatial-fixed-evaluation/2026-10-30T06-58-46-162Z-56035c6c/`。
- 20分钟执行期限结束，完成33/192观察，9个place ID（仅预测数量，不代表正确地点数）。146调用，usage估算USD0.1031433，另有1个unknown reservation，不是账单实付。进程查询确认无剩余该试跑node进程。
- 尚未处理到第一个空间重访候选，不能报告重访成功率或完整样本通过；无独立房间真值，不能把分组覆盖率当准确率。`stopped.json`保留状态，不自动续费/拼接或偷偷改算法。

## 后续

固定入口调用放大较明显，33观察消耗146调用/20分钟。需要先决定用更稀疏观察做明确命名的小样本、还是为完整192观察提高执行时限及调用预算（保持算法不变），不能声称这轮已经完成。若要验证完整在线助手，应另设明确端到端入口，不能把此固定方法2结果代替它。
