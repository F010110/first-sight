# 离线工具目录

不再把脚本、测试和模板堆在顶层。统一从仓库根目录执行：

```powershell
python -m sim --list
python -m sim serve_review_site --help
python -m unittest discover -s tests/python -t .
```

| 目录 | 用途 |
|---|---|
| `school/` | 学校样本、活动源、任务与来源校验 |
| `evaluation/` | 冻结、评测准备、结果审计、离线估计与旧版诊断 |
| `review/` | 人工审核站点、视频和门户 |
| `capture/` | 模拟器采集、导航、视角与数据格式 |
| `hssd/` | HSSD数据获取、采集和研究，不是正式算法默认入口 |
| `spatial/` | 视觉/几何/检索辅助工具与数据桥接 |
| `grouping/` | 早期分组、边界和身份实验，保留复现，不默认执行 |
| `context/` | 短期Context相关对照实验 |
| `benchmarks/` | 其他外部基准与历史实验 |

Python测试在 `tests/python/`，网页回归在 `tests/web/`，PowerShell执行监督在
`scripts/evaluation/`。TypeScript评测入口在 `src/sim/evaluation/`，旧回放在
`src/sim/replay/`，开发服务在 `src/sim/development/`。

旧命令 `python sim/foo.py ...` 改为 `python -m sim foo ...`。脚本名称保持可查，
[搬迁清单](../docs/maintenance/layout-map.json)记录全部旧→新路径。
历史文档中的旧命令仅用于说明当时的运行；复现原冻结结果使用对应git标签及原冻结编译产物。
任何付费操作仍需明确确认参数；列出工具不会发起模型或下载请求。
