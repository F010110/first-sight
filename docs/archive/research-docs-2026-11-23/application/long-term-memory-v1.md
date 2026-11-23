# 长期空间记忆 v1（冻结规格）

本版本固定软件存储、后台处理和修订协议；不等于无限容量、导航许可或新轨迹识别可靠性认证。旧离线纯VLM基线不改。

## 默认链路

登录→创建/打开持久库→上传原观察（202仅表示入队）→显式start→后台机械短窗口识别→SQLite原子提交→分页查询/地点访问/有证据拓扑边。stop后可人工confirm/merge/split/undo。worker状态暴露pending与最后确认时间，不把旧地点当作实时确认。

- Node >=22.13（实测24.21.0），SQLite内建模块，无额外数据库服务。
- SQLite WAL、外键、局部事务；观察/归属/地点/访问/转移证据/修订分表。全历史不常驻模型或服务内存。
- 最早pending等待10秒、正常最短调用间隔5秒、每次最多4观察；1秒timer、单在途请求，最多120 pending，失败暂停需显式resume/start。定时窗口不是整块唯一地点。
- qwen3.8-flash，enable_thinking=false，temperature0，max_tokens1800，120秒超时，无网络重试，最多一次协议修复。
- 模型候选至多6节点（当前/近期、最多2个出边邻居；显式文字检索可补全文候选），历史参考最多3候选各最新1个观察（每观察最多4图，合计最多12图）；本窗口原图全部展示。新节点candidate、程序分配UUID，退休节点不推理。
- 节点摘要＋首/末代表；访问折叠为时间区间、首末证据与稳定地点描述，原观察/理由/来源可按页展开。没有把跨时间物体状态聚合成“当前物体清单”。
- 每图1.5MB、最多4图，按年月/录制分片；只检查编码、头部签名和PNG尺寸，不声称完整图像解码/相机同步验证。磁盘剩余不足512MiB拒收，源须保留重试；不自动删除历史。
- sourceAtMs保留原采集时间，在线atMs采用服务器接收时钟；历史顺序与原时间分开。跨录制不建连接边，unknown打断转移；边为观察序列证据，不保证物理直接相邻/可通行。

## 接口

`POST /api/spatial`，沿用现有登录、同源与限流：

- create-library → libraryId/recoveryKey（仅创建返回秘密）；open-library附两者恢复。
- observe → id、recordingId、sourceAtMs、frames[{mimeType,dataBase64}]。
- start / stop / status。
- snapshot → limit（1..1000，默认100）、cursor（默认0），返回有限观察/归属、nextCursor和近期候选节点。**不再返回完整数据库。**
- search → query，返回有限候选；FTS trigram非视觉/语义搜索，少于3字符退回近期节点。
- place → placeId，返回节点、最近10访问摘要和最多20种相连边。
- revise → kind、sourceId、reason、evidenceIds，merge附targetId，split附summary；undo附revisionId/reason。需stop等待在途完成。

恢复凭据相当于库读写权限，须安全保存和HTTPS传输；没有账户找回、凭据轮换/撤销。切换库前先stop旧库；同库同进程共享worker，多进程并发推理不支持（数据库事务锁不等于分布式作业锁）。旧session私有路径兼容，不擅自认领或迁移到用户新库。

## 迁移、备份与回退

API首次加载若SQLite为空而同目录topology.json存在，事务导入并保留旧文件。失败不清空旧库；加载不触发付费识别。显式离线导入/导出命令见spatial-long-term-storage.md。全量导出属于维护操作，会用全量历史内存；不用于日常status。

局部修订只保存涉及节点/归属before-after，按涉及录制重建访问和边；有后续身份变化则拒绝冲突撤回，旧导入JSON修订不能直接用SQLite局部undo执行。JSON兼容备份保留全部审计，不保证退回旧JSON服务后仍可执行SQLite格式undo。备份SQLite请停止worker、关闭服务后连同原图片备份，勿在WAL写入中只复制主数据库文件。

## 验证

- `npm run test:long-term-memory`：9项相关测试（默认1000观察），含候选/访问/边、事务回滚、重启pending/undo、授权、分页、容量和忙时保护。
- 10000观察无模型测试通过约75秒，运行期候选<=6、历史观察上下文为空；全量备份往返一致。不当作无限规模或真实VLM吞吐证明。
- `python sim/test_spatial_http.py`：真实服务登录、建库、上传、换登录、错误秘密拒绝、进程重启、恢复pending且不自动调用；无API配置start503。
- 旧记忆回归75/75通过。
- 80真实观察图副本迁移：5地点、13访问、11转移证据、pending0，原数据不改。

## 明确未认证范围

候选检索仍可能漏掉很久以前的地点，不能仅凭有限目录无匹配断言全历史新地点。视觉向量检索、目录候选分层和主动扩展尚未实现；本版允许候选重复并可逆修订。没有长度硬编码不代表无限磁盘，历史保留/冷存储/云备份为后续运维决策。JSON导入和长单录制维护可能耗时；SQLite同步调用也可能造成短时事件循环阻塞。暂不接RequestAgent、变化Agent或前端，不冻结成整机产品已验收。生产VLM此前家庭结果可参考，但新SQLite API本轮测试不新增付费运行，不能宣称真实模型长时运行已通过。

冻结以后只做明确bug修复；检索策略/模型/提示/窗口参数变化另立版本，原报告、库和审计不挑选覆盖。
