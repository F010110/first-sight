# 长期空间记忆：SQLite存储层第一阶段

> 以下保留实现阶段记录。现已完成SQLite服务/API切换；最终默认和限制以`long-term-memory-v1.md`及同名JSON冻结规格为准。

目标是不限定历史录制长度，同时限制每次读取/模型输入。不是无限磁盘或无限上下文。

## 已实现

`src/agent/spatial-sqlite-store.ts`：SQLite WAL事务、外键、唯一观察ID、按录制/时间/待处理/地点的索引。原图仍在文件目录，数据库保存来源引用，不删除或复制原图。

- observations：原始观察JSON、录制ID、时间、pending；全历史不装入内存。
- places：稳定ID、摘要、状态、最多2代表观察。
- assignments：逐观察身份与原始字段，带外键。
- visits：连续访问区间，未知和录制断点中断访问。
- transitions：每次实际转移的观察对证据；聚合视图导出时组合成边。不跨录制造边。
- revisions：保留旧修订记录；新增SQLite原生局部修订/撤回，格式sqlite-local-v1，与导入旧快照审计区分。

ingest只查索引pending与最后时刻，commit只写当前批次/涉及节点/访问及边，并原子出队。读取pending和candidates均有显式数量上限（最多1000，日常默认4/6）。全文trigram搜索适用≥3字符的中英文子串；短查询暂退回最近节点，不冒充语义视觉检索。没有命中时可返回空，需要上层unknown/扩展检索策略。SQLite原生模块要求支持node:sqlite的Node版本，当前实测Node24.21.0；旧package声明>=20不代表该新模块可在Node20执行。

## 迁移与验证

`node dist/sim/spatial-sqlite-migrate.js import <new.sqlite> <old.json>`：仅空库导入，旧文件不改；失败事务回滚。

`node dist/sim/spatial-sqlite-migrate.js export <db.sqlite> <new.json>`：显式全量操作，禁止覆盖现有输出。全量导入/导出才使用完整历史内存，不能用于日常轮询。

无模型1000观察测试通过：顺序写入、有限检索、非法身份事务回滚、重启pending恢复、JSON来回一致。约6.8秒是本机单次测试，不是长期容量上限或吞吐承诺。

真实80观察副本迁移到`run/product-topology-sqlite-v1/memory.sqlite`：5地点、80归属、13访问、11次转移证据、0pending。11证据与旧图7种有向边是不同统计口径。原JSON和原图均未改，0新增VLM调用。

## 尚未切换的部分

生产`SpatialTopologyService`/API当前仍用旧JSON；本阶段新增存储层，不假称日常链路已去掉全量历史。下一阶段用该仓库替换worker持久化事务，再切库。模型仍需改为有限候选检索，不再传全部地点目录；当前FTS不等于最终候选召回方案。访问摘要/变化时间线折叠、原图分片写入、存储保留策略及大规模100k+压力测试也未完成。

## SQLite局部修订

`revise(merge|split|confirm,sourceId,reason,evidenceIds,options)`原子修改涉及的节点/归属，保存before/after局部事件及节点引用数。merge退休源节点不丢原判断，split真子集产生候选UUID；confirm显式确认。代表图通过索引选首/末重建。只对受影响录制重建访问及转移证据，不扫描所有其他录制；长单录制修订成本仍可能高，不宣称常数时间。

`undo(id,reason)`支持进程重启后撤回；如相关节点、归属或引用数已变化，拒绝覆盖。未相关的新历史可保留，不用整个数据库状态作为撤回条件。原图/原观察不改，originalPlaceId保留首次判断。导入旧JSON修订不能用新局部撤回器直接执行，避免混淆格式。显式全量JSON导出包含局部审计，属于备份而非旧JSON服务的完整回退迁移合同。

新增测试验证拆分/合并后访问和边、重启撤回、首次归属恢复、后续重访冲突拒绝和失败原子性。build及两项SQLite测试通过（含1000观察压力测试），没有付费模型调用。
