# 长期记忆：样本验收、token校准与长测准入

## 方法与阶段

1. 原始数据独立保存，固定来源revision/hash，三摄检查索引及解码，位姿只供评测。先验收路线实际覆盖，不能因环境标签就保证本条轨迹进屋。
2. 固定10秒采样作为基线，不加运动门控；三摄原图保留。离线实验最多4观察合一窗口，在线实时10秒触发策略另测，不能混用费用或响应时延结论。
3. 校准单独运行，qwen3.8-flash + enable_thinking=false。冻结v1代码不改，实验入口`src/sim/spatial-calibration.ts`。结果目录必须新建，原始input/response/usage/停止原因全部保留。
4. 长跑要求真实端点输入/输出单价、币种、金额上限、窗口上限和观察上限。每窗口预留最多两次请求（包含一次协议修复），每请求按128k输入/1800输出的保守界估算，预留后超过金额上限则调用前停止。价格必须匹配端点和上下文价格档位，若还有其他计费项必须先补齐；这是配置价估算不是账单级担保。usage缺失停止，不按0元处理。网络失败可能已计费，记录失败并停止。
5. 单价未确认时允许**极小token校准**：显式tokenCalibrationOnly=true，最多2窗口/8观察，含修复最多4 provider请求；estimatedCost=null，不假装有人民币硬上限。它不能用于长测。
6. 长测前补旧地点召回：冻结v1近期/邻居候选作为对照；新开发层需要建立原图驱动的历史候选索引，与文字/近期候选合并后仍限制模型候选/图片数。每次记录候选来源和旧地点是否入选，分别算候选Recall@K与最终身份准确率。当前没有实现此索引，不把本次近时重访当跨整天召回能力证明。
7. 长测使用不同路线的多会话，存在独立真实重访、停留和变化；先校准15–30分钟，之后再8小时。已有177秒轨迹不能通过循环或复制时间变成长测。活动间隔如使用逻辑时间，单独标记。
8. 第二轮才加本地视觉门控，比较同一源数据的事件漏检、延迟、付费调用下降。IMU只作短时转动/活动提示，不用积分位移。关键帧累计比较、三摄、遮挡不确定和静止变化巡检均须纳入；目前未接入生产链路。

## 本轮真实样本与结果

下载`D:\Datasets\TartanGround\pilot-v1`，HF revision `388faf9c800568cfc6828fa47e063f8369397eb3`。学校和社区P0000各front/left/right及metadata全部SHA256验证。首轮TLS EOF保留shell失败记录，脚本增加有限重试及Range续传，未关闭证书验证。

学校：三摄各1776帧，索引0..1775完全对应。metadata time_step=0.1，源时长177.5秒，path_length约209.96米。接触图确认室外建筑、围栏球场/庭院进入室内走廊及大厅；未证明正常运营学校、食堂、多个教学区域或整天覆盖。接触图`run/tartanground-school-audit-v1/contact-sheet.jpg`。

社区：三摄各536帧，索引完全对应，名义53.5秒；接触图主要住宅街道/院落，本条未看到室内，不能仅以IntExt名字称其室内外回放。`run/tartanground-neighborhood-audit-v1/`。

学校10秒采样产生19观察（末帧额外保留），图像在Agent包，位姿/coverage在evaluation-only。脚本`sim/pack_ground_pilot.py`。只是一条独立采集，不是多会话。

极小真实校准：选择源帧0/100/300/400/1000/1100/1200/1300，共8观察、24原图，按4观察合一窗口，真实2次请求、0协议修复、pending0。输入12850token、输出1133token，请求耗时12.306秒及7.443秒。结果`run/tartanground-school-real-calibration-v1/`，并非15–30分钟校准已完成。

模型产生3个候选地点。私有位姿中帧300→1100间隔80秒/0.91米，最终归到同一place ID；这是**1个几何代理重访对**，不是房间准确率或跨天召回认证。室内切换产生不同ID。需要独立标注更多正负例，尤其相似走廊、反向视角、候选数超过6后重访。

以此样本粗略外推8小时、10秒采样且固定4观察合批，720窗口≈462.6万输入+40.788万输出token。金额公式：4.626×输入每百万价 + 0.40788×输出每百万价。上下文增长/图数/修复会改变消耗；在线每10秒调用、窗口不满4或Agent另行调用不能使用该外推。原先20元仍只是示例，未核对端点单价，不报实付费用。

## 命令

```text
python sim/download_ground_pilot.py D:\Datasets\TartanGround\pilot-v1
# 图像audit需要Pillow；本机使用WSL EAM的既有venv，不污染系统Python
python sim/audit_ground_pilot.py SOURCE NEW-audit
python sim/pack_ground_pilot.py SOURCE NEW-dataset
npm run build
node --test dist/sim/spatial-calibration.test.js
node --use-env-proxy dist/sim/spatial-calibration.js DATASET NEW-result CONFIG --confirm-paid
python sim/summarize_spatial_calibration.py RESULT DATASET/evaluation-only/coverage.json NEW-report.json
```

金额配置字段：inputPerMillion/outputPerMillion/maxCost/maxWindows/maxObservations/currency；token小校准字段：tokenCalibrationOnly/maxWindows/maxObservations。价格缺失不能用假价启动金额长测。

## 当前准入决定

原图/元数据可用、极小真实推理通过，预算拒绝与usage缺失停机mock集成测试通过，v1冻结hash通过。**不启动8小时**：端点实际单价、更多独立路线及持续覆盖、旧地点扩展召回、独立准确率标注均未完成。接下来先增加学校不同路线的metadata检查重访交集再选择图像包，不盲目全库下载。
