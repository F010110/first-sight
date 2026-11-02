# 数据、历史运行与证据登记

更新：2026-11-02。路径相对仓库；数据/数据库不随Git文档自动迁移。未逐一复验所有历史hash，标明来源；运行前重新验证。不得覆盖原目录。

## 当前UnionCity基准

- `run/gmod-annotated-rerender-v2-final/`：用户确认位置标注、813组原始三摄、42访问段、35区域ID、3显式重访及地图/bindings。
- 公开输入：`run/unioncity-questions90-v2-run1/input.json`，SHA256 `78735bd7e0b9ab61aaa27c984471db6a75751b616730ce900df113cb78c3ec40`。
- 标注是观察者所在区域，不是三摄各方向所有可见区域。`referenceAnnotation` 是附近人工查看关键帧细节，不认证插值时刻每个物体存在。
- CAFÉ外廊、吧台、台球和卡座属于同一场所的不同区域；建筑内电梯/上层/屋顶曾按地图实体支持公寓归属，不凭装修认证HOTEL。动态电梯重渲染不能代证原互动。
- `run/unioncity-reviewed-position-freeze-v1/`：零API冻结，7同区域、16异区域、22同场所异区域，共45关系，排除边界/有限可见端点；pendingHumanReview=0。不是全813帧关系覆盖集。
- `run/unioncity-position-relations-v3/`：旧48卡抽样，绝大多数触边界/有限可见，不作为现行标准；页面曾因缺distance字段toFixed崩溃，已修，HTTP200不等于渲染正常。

## 问答冻结与隔离

- 原15题：`run/unioncity-repair-pilot-v2-freeze/`，tasks、references、calibration notes、plan绑定，37分支门槛保留。
- 原90题：`run/unioncity-questions90-v2-freeze/`，仅门槛通过且用户决定后启用，不自动重写题目或扩大。
- 原公开输入不包含位置标签/地图/私有答案。任何评审bundle都是oracle-only，不可用作空间Agent生产输入。

## 最近运行（均不得冒称完整空间记忆验收）

|目录（run/下）|完成事实/结论|
|---|---|
|`unioncity-realtime-full813-v1`|调度未resume，9条归档、0状态，1800075ms超时；失败保留|
|`unioncity-realtime-full813-v2`|813事实/813快照，642389ms；原实时两槽事实生产，不是完整空间判断|
|`unioncity-realtime-full813-v2/spatial-score-v1`|快照/持久事实/时间绑定审计通过；45关系无显式判断，不是45项语义错误|
|`unioncity-memory-review-v1`|只评上述已有事实状态。813执行、644有效、169校验失败、pending0；4并发约2735.3秒，未达10–20分钟预估|

裁判有效子集：location632项/3.4541，organization243项/3.7860，history237项/3.6835，calibration642项/3.2866（满分4）。其余含不适用与未评分；**不是全分母准确率，不是定位/重访能力证明**。169失败均报Unbound review issue；离线检查发现非精确quote和不存在referenceField，可能同项多个原因。旧原始响应不删除、不放宽校验直接放行；还需审查裁判是否拿可见性标签要求无谓免责声明等越界扣分。

完整第一次裁判执行约45分35秒，不要继续承诺4并发能20分钟内结束。完整运行原始用量在 `judge-requests/`；不在未汇总/核账前编总成本。

## 重要历史证据与教训

- `run/gmod-source-bound-soak-v1/`：576/576，源节奏1221130ms、两槽、零失败、p50推理≈1692ms、事实p95≈3040ms、积压峰4、尾部追平≈2105ms。严格实时验收false；只证明有限负载下软实时事实生产，不证明空间身份。
- `run/unioncity-pi-spatial-replay-v1/`：813完成，但旧站台未决点跨802次更新残留，空间语义未过；v2在169停止，保留。
- `run/unioncity-spatial-diagnostic-ledger-probe-v{1,2,3}/`：来源账本与召回小样本，385错过71、793弱红砖/树/阴天推同楼等；工具调用成功不等于正确关联。稀疏探针不能代连续场景。
- `run/unioncity-spatial-qwen-max-review-v1/`：continuous60的Max多轮开发复核，60双评、16裁决、155调用、6控制两遍通过、未知预留0（历史记录）。ordinal grounding94.58、其他维度100；不是事实准确率。65内外边界、84闭门误开、106旗当灯、111路标、115棚数量问题；裁判也曾幻觉OCR，不是全部人工确认错误。
- `run/unioncity-full-memory-standard-v1/`：已废止逐帧细节造标注，566帧、6265草案事实、975unknown历史产物；不因缺frozen.json继续烧钱补齐。
- `run/window-context-full-replay-v6/`：851观察/217窗口、63候选地点/72访问/58转换、11未知、221HTTP、估算USD0.33538；完整链路审计，不是空间语义准确率（早期校园数据，不是UnionCity813）。

## 必须保护的旧资产

- 旧SQLite历史hash `297f3bdfae324970af2e18e70d71769376907e61d475b867aaf54f008bda8290`；旧冻结组织索引hash `65d67eb441928ab8248d447a1ee767b7ac378b2e2229c1f21180a72fd02b9fa8`。这里是保护标识，修改前定位实际路径并复验，不猜文件。
- `run/unioncity-organized-index-v{1,2,3}/`：2段/23段/21候选段，保留失败原型；不是物理地点真值。原事实/来源全保留；旧机制可能可靠性不足。
- `run/unioncity-questions90-v2-summary1/report.md`：旧90题87/90交付，自动初评分存在安全漏判、通道矛盾与长期资格污染，不能作为现行认证。
- 旧15/37各轮失败、调查成本/未知预留见历史报告46–56；原门槛从未通过，不能换新标准重置历史费用或称旧失败不存在。
- `run/unioncity-incremental-organizer-audit-v1/receipt.json`：813事实、51前缀、5重启、幂等及知识前缀验证；组织回调失败不撤销事实提交，漏通知启动对账。不是在线吞吐或语义正确率。旧组织15题开发效用50%、7/15≥3，37仅36交付，门槛失败（报告49）。
- `run/unioncity-investigator-generic-v1-{freeze,run1,score1}/`：7题全部交付，5题开发4分、L09/L23为0；后两题未调查、用当前替代历史。不能恢复题型强制路由掩盖失败；报告56移除专用计数协议覆盖52早期方案。
- 独立校园空间包 `run/campus-spatial-memory/2026-10-20T13-42-03-856Z-ecad0254/`：851观察、218空间调用、估算USD0.330322218；其后的question-only重用验证库hash `a1bcf17ee1890e1d8d6368b0ee8e7fd7cb0705f5a6e28dcfc58636b53e2eec60` 不变，三问最终完成不是全空间语义验收。连续观看视频 `run/campus-continuous-native10-v1/` 为10段16707原生帧/1670.7秒，视频播放10fps不意味着空间推理10fps。

## 非主线数据资产（不丢失入口，不自动续做）

- TartanGround HF revision `388faf9c800568cfc6828fa47e063f8369397eb3`，CC BY4.0轨迹数据不等于底层游戏资产许可。
- P0006完整1504三摄组在 `datasets/tartanground-moderncity-P0006-complete-v1`；公开2秒采样77观察，旧固定运行只完成42/77，不能拼成全片。位姿侧车 `datasets/fixed-pose-routes-p0006-v1/`、`run/fixed-pose-routes-p0006-{geometry,narration}-v1/`。
- 旧24题 `datasets/tartan-route-qa-p0006-v2/`、`run/tartan-route-qa-qwen-minimal-v1/report.json`：17/24=70.83%，邻帧位置图库与旧反向拒答规则，不是当前记忆成绩；脚本gold24/24永远不是模型成绩。
- UTE P01/P04原片/浏览器副本、EgoLife两段20分钟工程样本、ReplicaCAD/HSSD/THOR采集/家庭分组实验保留；不能当已完成全天生活或长时实机评测。
- 自建低细节Three.js校园已被否定为主要评测材料，不因目录存在重新启用。

更多工件来源：历史03、04、43–77同步记录与生成目录。文档引用不是对每个目录内容已核验的保证。
