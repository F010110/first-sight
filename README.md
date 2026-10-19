# First Sight · 第一视角空间记忆

**正式版本：v1.2.0**。持续进行窗口级空间判断，独立短期Context与SQLite长期记忆配合，通过检索并查看原始图像回答问题。

## 当前结果与范围

学校样本完整连续回放：851个观察、90题，全部形成最终答案。独立上下文自动评分：

| 能力卡 | 得分 |
|---|---:|
| 实际问题解决 | 96.7 |
| 长程与干扰 | 94.1 |
| 回答可信 | 96.4 |

当前／短期／长期解决得分为 **100／93.3／96.7**。
这是开发集、同模型族自动评分，不是独立人审或安全认证。正式发布保留已知的场所误认、楼层误判、关机时段无依据断言等限制，不支持安全导航保证。

- [v1.2.0发布说明与已知问题](docs/releases/v1.2.0.md)
- [完整实测记录](docs/application/inspect-repair-full90-results.md)
- [架构与空间Context](docs/application/spatial-context-refactor.md)
- [地点轨迹人工审核](docs/application/spatial-graph-human-audit.md)

## 开发与测试

Node.js ≥22.13（本次实测Node 24）；Python工具建议使用独立虚拟环境。

```powershell
npm ci
npm run typecheck
npm test
python -m pip install -r requirements.txt
python -m pip install -r sim/school/requirements-activity-review.txt
python -m unittest discover -s tests/python -t .
python scripts/check-doc-links.py
```

构建只写 `dist/current/`，不覆盖历史冻结编译产物。测试不触发付费评测；付费命令需单独明确确认。

```powershell
python -m sim --list
python -m sim serve_review_site --help
```

完整90题运行／评分命令见[发布说明](docs/releases/v1.2.0.md)。数据与API凭据不进git；模型调用需要环境变量 `QWEN_API_KEY`、`QWEN_BASE_URL`。

## 仓库导航

| 路径 | 职责 |
|---|---|
| `src/agent/` | 空间推断、独立短期Context、长期拓扑、检索和旧应用Agent |
| `src/sim/evaluation/` | 当前连续评测及配套问答／评分工具 |
| `src/sim/development/` | 本地开发服务与诊断 |
| `src/sim/replay/` | 历史回放／对照实验，不是默认生产入口 |
| `sim/` | 按学校、HSSD、采集、审核、分组等分类的Python工具 |
| `tests/python/`、`tests/web/` | Python与审核页回归测试 |
| `scripts/` | 应用图像桥接、测试与运行监督 |
| `web/` | 保留的手机试用前端；尚未全面迁移到新Context循环 |
| `docs/` | 当前手册、发布说明、研究与历史归档 |
| `run/`、`dist/` | 本地产物，不进git；冻结结果保持原路径，不修改证据 |

[工具目录](sim/README.md) · [文档索引](docs/README.md) · [当前任务](TODO.md) · [整理与复现规则](docs/maintenance/repository-layout.md)

旧手机试用操作见[手机手册](docs/application/mobile-trial.md)。旧研究介绍和长篇工作日志已[归档](docs/archive/README.md)，不再作为当前版本状态。
