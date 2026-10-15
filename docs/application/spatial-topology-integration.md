# 增量拓扑记忆软件接入v1

保留既有`PlaceMemory`生产链路；新入口`src/agent/spatial-topology-service.ts`独立文件，不静默迁移旧Place/Space语义。当前验证目标是回放/后台记忆底座，不是RequestAgent已接入。

## 数据结构

- 节点：稳定UUID、实例布局摘要、首/最新代表观察、最近出现时间。VLM引用历史UUID，新候选使用请求内new-N，程序原子提交时分配UUID。
- 原观察：唯一录制＋观察ID、原图路径、原时间sourceAtMs、回放排序时间atMs。原图由采集源保管，本服务不删除/复制，不声称移动源目录后仍可恢复图像。
- 访问序列：逐观察assignments，不把机械块当地点；未知null切断转移链。
- 有向边：连续已处理观察从A到B，记录原观察对证据。只表明观察序列转移，不证明直接物理邻接，不提供导航许可。跨录制不创建虚构连接边。
- durable inbox：全部待识别观察ID落盘；识别成功后身份、节点、边和出队一起原子替换文件。超时或无效答案不出队，重启可继续。

## 调度

一次最多4观察，待处理最早观察10s后可启动，正常调用最短5s。tick由采集事件/调用者定时器提供；VLM忙时重复tick复用同一promise，没有每个tick创建调用任务。新观察仍可写入inbox，查询快照不等待模型。识别上下文无未处理未来观察。

inbox只存轻量引用，默认最多120待处理观察，容量满时拒收并要求采集源保留原数据重试，不静默丢弃。尚无磁盘字节/历史录制长度硬上限；JSON原子快照在长录制中会变大，后续可转日志/数据库。是背压底座而非全资源限额方案。服务不自动重试付费请求，失败保持待处理；调用者显式恢复。终止录制flush允许不足10s窗口。当前回放顺序await模型，不是实时间隔采集压力测试。

`SpatialTopologyWorker`提供1秒调度timer（须使用与观察atMs相同的时钟域）、只等待落盘的accept、忙时pump合并、失败暂停及显式resume/stop。stop等待当前调用收尾，不自动付费清空pending。状态同时给最后确认时间、pending与hasUnprocessedObservations，不能将旧currentPlaceId冒充当前已确认位置。timer实现已单测，尚未挂服务器采集路由。

## VLM与回放

`spatial-topology-vlm.ts`显式qwen3.8-flash/enable_thinking=false，最多3最近访问节点各1历史代表，当前块全部图，1800输出上限/120s超时/无自动协议重试。请求上下文、响应usage与失败类型保存，不记录凭据。局部地点允许开放空间中实例可区分区域，不因功能标签拆分，不编造墙体。

`node --use-env-proxy dist/sim/spatial-topology-replay.js <capture> <memory-directory> <recording-id>`

相同录制ID恢复时跳过已入库观察，先处理pending；不同录制ID复用节点目录，原时间保持，排序时钟明确平移，边不跨录制。新轨迹身份匹配能力需独立实测，重复同一录像不能认证跨路线泛化。

## 验证与尚缺内容

### 候选与可逆修订

新节点默认candidate，旧v1文件缺状态时按candidate加载；只有显式confirm提升，自动重访不等于人工确认。支持`revise(kind,sourceId,reason,evidenceIds,options)`：merge保留源节点为retired并重绑观察；split只允许原节点的非空真子集，新UUID候选；confirm需证据。修订均重建代表和有向边，原始观测与首次身份originalPlaceId保留，before/after审计日志随图原子保存。retired节点不再进入VLM目录。

`undo(revisionId,reason)`恢复该次身份快照，不删除审计；如之后产生新身份决定或修订，则拒绝直接覆盖，避免丢掉新工作。修订需要停止worker且无在途识别；暂停并确认收尾后操作。暂未提供HTTP/UI审核按钮或自动重复地点建议，不自动合并P5走廊。4相关测试通过，包括修订跨重启恢复、边重建、原图记录不变及冲突拒绝。

### 服务器接口

`POST /api/spatial`沿用trial-server已有登录、同源检查、请求体上限与限流。action：status、snapshot、observe、start、stop、revise、undo。observe成功202，仅代表持久化入队，不代表已识别。默认加载/上传不启动模型，必须显式start；stop等待在途完成但不清空pending。revise/undo须先stop。

observe字段：`id`、`recordingId`、非负原始`sourceAtMs`、`frames:[{mimeType,dataBase64}]`，最多4图、每图1.5MB；不接受客户端文件路径，原图复制到服务器私有目录。服务器接收时钟用于timer，原时间独立保留。当前检查编码/类型/大小，尚未验证真实图像解码和多摄同步。队列满/非法字段明确报错，未成功接收源必须重试。

revise字段：`kind: merge|split|confirm`、sourceId、reason、evidenceIds，合并附targetId、拆分附summary。undo字段revisionId、reason。snapshot包含原图服务器路径与审计，仅向会话所有者提供，不直接公开图片URL。

存储当前按session ID隔离：`<experimentRoot>/<sessionId>/spatial-topology/`。新登录不自动认领旧会话目录；跨登录长期用户/记忆库授权映射尚缺，不能将文件可恢复当账户记忆恢复已完成。API实例当前不自动驱逐运行worker，达到会话容量拒绝新建；旧会话清理/资源预算仍需完善。旧SceneAgent/RequestAgent/变化Agent未切换。构建与5相关单测通过，尚未做真实HTTP/浏览器端到端验收。

### 长期记忆库恢复（新增）

登录后`action:create-library`返回libraryId/recoveryKey（256位随机秘密，仅创建时返回）。请安全保存；凭据持有人有读写权限，不是只读分享链接。服务器只存秘密SHA256摘要，不接受目录路径。`action:open-library`附libraryId/recoveryKey，在新登录后绑定原库；库ID本身不授权。存储在`<experimentRoot>/spatial-libraries/<libraryId>/memory/`，同库多个登录共用一个worker，避免多写者。默认session私有路径仍保留兼容，不自动搬迁旧数据。

加载库不自动启动付费识别，仍须start。恢复凭据应仅通过本地可信连接/HTTPS传输；没有恢复凭据轮换、撤销、账户体系或找回流程。切换库不会自动停止此前显式启动的库worker，切换前应stop。进程重启后需重新登录/open-library/start，持久化pending保留。

`sim/test_spatial_http.py`真实启动隔离trial-server测试登录→建库→上传→第二次登录→错误秘密拒绝→正确秘密打开→读取同一pending；移除API配置验证start返回503，全程0模型调用。临时服务与数据测试后关闭清理。HTTP测试通过，6相关TS测试通过；浏览器交互及跨进程恢复完整HTTP测试仍待补，不把两次登录当服务器重启验证。

build通过，2拓扑单测覆盖落盘/重启、同窗口多区域、重访稳定ID与转移证据、忙时合并、不丢pending、失败恢复及跨录制隔离。val5真实VLM回放已启动`run/product-topology-val5-v1/`，结果尚未验收。尚未接服务器采集timer/RequestAgent/变化Agent；摘要修订合并拆分撤回未实现，节点保留候选语义，不声称最终确认。
