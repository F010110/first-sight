# 长期空间记忆：SQLite存储层第一阶段

目标是不限定历史录制长度，同时限制每次读取/模型输入。不是无限磁盘或无限上下文。

## 已实现

`src/agent/spatial-sqlite-store.ts`：SQLite WAL事务、外键、唯一观察ID、按录制/时间/待处理/地点的索引。原图仍在文件目录，数据库保存来源引用，不删除或复制原图。

- observations：原始观察JSON、录制ID、时间、pending；全历史不装入内存。
- places：稳定ID、摘要、状态、最多2代表观察。
- assignments：逐观察身份与原始字段，带外键。
- visits：连续访问区间，未知和录制断点中断访问。
- transitions：每次实际转移的观察对证据；聚合视图导出时组合成边。不跨录制造边。
- revisions：保留旧修订记录；当前支持迁移，尚未实现SQLite原生局部修订/撤回。

ingest只查索引pending与最后时刻，commit只写当前批次/涉及节点/访问及边，并原子出队。读取pending和candidates均有显式数量上限（最多1000，日常默认4/6）。全文trigram搜索适用≥3字符的中英文子串；短查询暂退回最近节点，不冒充语义视觉检索。没有命中时可返回空，需要上层unknown/扩展检索策略。SQLite原生模块要求支持node:sqlite的Node版本，当前实测Node24.21.0；旧package声明>=20不代表该新模块可在Node20执行。

## 迁移与验证

`node dist/sim/spatial-sqlite-migrate.js import <new.sqlite> <old.json>`：仅空库导入，旧文件不改；失败事务回滚。

`node dist/sim/spatial-sqlite-migrate.js export <db.sqlite> <new.json>`：显式全量操作，禁止覆盖现有输出。全量导入/导出才使用完整历史内存，不能用于日常轮询。

无模型1000观察测试通过：顺序写入、有限检索、非法身份事务回滚、重启pending恢复、JSON来回一致。约6.8秒是本机单次测试，不是长期容量上限或吞吐承诺。

真实80观察副本迁移到`run/product-topology-sqlite-v1/memory.sqlite`：5地点、80归属、13访问、11次转移证据、0pending。11证据与旧图7种有向边是不同统计口径。原JSON和原图均未改，0新增VLM调用。

## 尚未切换的部分

生产`SpatialTopologyService`/API当前仍用旧JSON；本阶段新增存储层，不假称日常链路已去掉全量历史。下一阶段用该仓库替换worker持久化事务，并保留原修订能力：先实现局部修订事件与受影响边/访问重算，再切库。模型仍需改为有限候选检索，不再传全部地点目录；当前FTS不等于最终候选召回方案。访问摘要/变化时间线折叠、原图分片写入、存储保留策略及大规模100k+压力测试也未完成。
