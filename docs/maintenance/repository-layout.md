# 仓库组织与保留规则

## 三层职责

- 当前V2实现：`cam/src/network_camera.h`→`cam/host/push_stream.py`→`src/hardware/realtime-*`→`src/desktop/realtime-server.ts`／`live-recordings.ts`→`web/desktop/realtime.*`／`recordings.*`；[架构图](../product/v2-system-map.md)。`src/agent`是共享协议／空间推理及历史算法集合，`src/sim/evaluation`属于评测，不是实时服务。
- 研究工具：`sim`下按学校／HSSD／采集／审核／分组等分类，不混进核心默认路径。
- 历史：`docs/archive`、`docs/experiments`、`docs/research`明确保留旧结论、失败和未完成研究，不当当前运行状态。

`sim`顶层不再接纳独立脚本。新工具放入功能包并登记[工具注册表](./layout-map.json)；测试放`tests/python`，对应TypeScript测试仍邻接源码。禁止为保持旧路径大量新增一行包装脚本。

## 命令迁移

```text
python sim/foo.py ...        -> python -m sim foo ...
python sim/test_foo.py       -> python -m unittest tests.python.test_foo
node dist/sim/foo.js ...     -> node dist/current/sim/{evaluation|replay|development}/foo.js ...
```

具体旧→新路径在`layout-map.json`。Python跨包导入使用`sim.<feature>.<module>`，不修改全局sys.path或使用同名假模块；CLI仅通过runpy运行明确登记的工具。

历史文档内的代码块保留当时命令，非当前手册。Markdown链接已更新；原冻结二进制与运行回执不动。

## 产物与环境

| 路径 | 处理规则 |
|---|---|
| `dist/current` | 当前构建，可再生；不与冻结快照混用 |
| `dist/<冻结版本>` | 保留原路径／哈希；原回执依赖该路径 |
| `run/<实验>` | 原图证据、模型响应、数据库、失败、分数不覆盖、不拼接 |
| `run/review-site` | 正在使用的审核网站与浏览器导出，保留可访问 |
| `.venv`、`node_modules` | 本地依赖，忽略，不纳入版本 |
| `datasets`、`reference-code` | 本地外部数据／参考仓库，许可独立，不分发 |

本次不为减少文件数删除原始实验数据、失败版本、冻结编译产物或审核结果。它们是评测溯源证据，不是普通临时缓存。临时Python缓存等可再生文件与这些证据区别对待。

## 本次整理的保护措施

整理前将已有未提交需求／HSSD／README／TODO等工作独立保存在`9b6bd84`，再迁移。文件搬迁有328条清单；顶层需求材料归入`docs/requirements`，建议归入`docs/notes/suggestions`；原长篇README和TODO分别归入`docs/archive`，当前入口重写为短索引。

旧long-term-memory-v1的冻结测试原来错误地拿不断演进的当前源码对比2026-10-15哈希。本次改为核验其原冻结提交`dcc270f`，没有改旧manifest或冒称当前代码未变化。新正式版另有发布记录与git标签。

## 后续维护

V2实际脚本分类与55条迁移清单见[V2整理验证](v2-layout-validation.md)及[v2-layout-map.json](v2-layout-map.json)。`scripts/`顶层仅留导航，工具按testing／maintenance／media／datasets／spatial／review／evaluation／network分类；相机主机端移到`cam/host/`，构建钩子移到`cam/build/`；桌面实验／评分移到`src/sim/evaluation/`。不保留一行旧路径包装。新增文件须遵守[scripts导航](../../scripts/README.md)。

本次完整验证记录见[v1.2.0整理验证](./v1.2.0-layout-validation.md)。本地产物索引可用`python scripts/maintenance/index-local-artifacts.py`重新生成，只写INDEX，不搬迁或删除证据。

1. README只写当前状态与入口；实验过程放报告，完成历史不要继续堆进TODO。
2. 实验版本和失败保持独立目录；不为“整理”重写原回执中的绝对路径与hash。
3. 搬迁必须核验导入、模板路径、subprocess命令、构建与文档链接。
4. 新测试不依赖冻结旧dist可偶然命中；使用当前构建路径。
