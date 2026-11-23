# First-Sight · 持续空间记忆

从连续第一视角观察中维护地点、访问、历史来源和当前位置，供独立用户问题Agent只读使用。项目保留生活助手与相机原型，同时研究长期移动中的空间记忆；**不是已验证的安全导航产品，也未完成通用具身导航系统。**

**架构契约**：[docs/active/](docs/active/README.md) · **当前状态与待办**：[TODO.md](TODO.md) · **执行约束**：[AGENTS.md](AGENTS.md)

本入口于2026-11-10整理。`package.json`版本为2.1.0；包版本不代表全部空间能力已通过验证。旧v2.0.0单摄原型不再代表当前空间记忆研究主线。

## 核心设计

```text
连续观察 → 原图耐久归档 → 独立快速感知事实
                          ↓
              持续空间Agent（Pi Session）
              ↔ 有界、独立压缩的短期Context
              ↔ 长期地点／访问／历史来源与追加修订
                          ↓
              固定版本共享空间模块 → 独立只读问答Agent
```

获批分层方案初始配置为约6秒感知、40秒空间批次；一批可以包含多个有证据片段。图像匹配只提供视觉关联，**同一建筑可见不等于当前占据同一区域**。来源、事务发布、因果截止和有界过载规则见[架构](docs/active/01-spatial-memory-architecture.md)，实现完成度另看TODO。

## 验证到了哪里

|项目|已知边界|
|---|---|
|连续运行|一轮813观察实时基线完成归档/覆盖，未见跳过或投递违规；不等于空间语义正确|
|地点与重访|最后两轮未达标，当前实验路线已停止；局部证据→最终分组一致性及根因隔离未解决，不认证可靠重访|
|ULVN相关匹配|MegaLoc＋SuperPoint/LightGlue已实际CUDA运行；可切换实验后端，默认legacy，不是完整ULVN/BPL复现|
|下游对照|v10有证据说明与实际图片冲突等测试缺陷；原结果保留，不据其目标ID命中率宣称后端更优|
|完整架构|经历/实体/关系修订、丰富检索及正式问答等按阶段实施，不能宣称全部完成|

详细数字、失败与下一步统一看[TODO](TODO.md)，避免README维护第二套实时日志。[ULVN阶段说明](docs/notes/ulvn-integration-status-2026-11-10.md) · [v10原因分析](docs/notes/ulvn-v10-cause-analysis-2026-11-10.md)。

用户指定的[最后两轮验证及停止结论](docs/notes/revisit-final-two-tests-2026-11-10.md)已收束为实验失败，不再自动推进后续重访测试或集成。

随后用户重新授权的[源头提示词对照](docs/notes/revisit-prompt-origin-results-2026-11-10.md)也已结束：提示词有局部收益，但不足以可靠修复当前VLM身份认证/分组方案，未推广至生产。

[ULVN前端适用范围实测](docs/notes/ulvn-operating-range-results-2026-11-10.md)显示近位置/跨方向关联与暖检索有收益，语义分组及完整BPL未认证；混合路线仅为提案。

后续[空库顺序813纯视觉增量试验](docs/notes/ulvn-sequential-results-2026-11-11.md)已完成：固定重访控制改善、开销降低，但全程审查仍有局部几何误合并和连续性候选遗漏；不把它称为官方原版或生产可用分组器。

## 开发与免费检查

Node.js ≥22.13；Python工具使用各自虚拟环境，ULVN单独使用Python3.11，不替换项目环境。

```powershell
npm ci
npm run typecheck
npm run build
npm test
python -m unittest discover -s tests/python -t .
python scripts/testing/check-doc-links.py
```

全套测试与针对回归的通过范围不同；不要把“构建通过”称作“全部能力通过”。构建写入 `dist/current/`，旧冻结编译产物保留。模型密钥由环境变量配置，不写入Git；模型运行须显式付费确认，不批量执行未知脚本。

## 按任务找入口

|任务|入口与使用边界|
|---|---|
|空间记忆服务|`src/assistant/spatial-memory/`：持续判断、Session、工作Context、SQLite、单写入与批次提交；不是整个目录都属历史代码|
|连续空间运行|`src/sim/evaluation/run-spatial-memory.ts`；构建后CLI为 `node dist/current/sim/evaluation/run-spatial-memory.js`，执行须提供输入、新输出目录及 `--confirm-paid`|
|ULVN安装与本地对照|[操作说明](scripts/media/ULVN-MATCHER.md)；本地推理不调用付费VLM，首次联网下载权重|
|VLM分组诊断|`src/sim/evaluation/repeat-revisit-probe.ts`：有界冻结Context模拟器，**不等于真实Session全链路验收**|
|只读失败分析|`scripts/evaluation/diagnose-revisit-backend-probe.py`；读取指定原始报告，不调用模型|
|桌面与硬件原型|`src/desktop/`、`src/hardware/`、`web/desktop/`；`npm run realtime`／`realtime:three`为独立入口，模型付费行为须先核配置，不与离线研究结论混用|
|相机配置与操作|[cam/host/README.md](cam/host/README.md)、[既有V2运行手册](docs/application/v2-realtime.md)；不把旧单摄步骤当三摄通用操作|
|审核与复现|`src/sim/evaluation/`、`scripts/evaluation/`、`scripts/review/`、`sim/`；评分与生产事实隔离|

## 工作区导航与保留规则

|目录|职责|
|---|---|
|`docs/active/`|有效架构与理由、实施方向；不是结果日志|
|`TODO.md`|当前状态、阻断、验证与下一步的直接依据|
|`docs/notes/`|调查、提案与诊断，不自动成为架构或成功结论|
|`docs/application/`、`docs/product/`、`docs/releases/`|对应阶段手册、产品方案和发布记录；按日期与适用链路理解|
|`docs/archive/`、`docs/project-sync/`|历史线索，不能覆盖active或TODO|
|`src/agent/`|共享模型/协议和多代算法，须按实际入口区分|
|`scripts/`、`sim/`|按功能分类的工具；见[脚本导航](scripts/README.md)和[sim导航](sim/README.md)|
|`tests/`及源码邻接测试|免费回归与工具检查；运行前确认范围|
|`run/`、`dist/`|本地实验、原图、数据库、响应、失败和编译产物；冻结证据不覆盖|
|`data/`、`datasets/`、`integrations/`、`evaluation/`|按各自内容/清单判断用途及许可，不自动上传或清理|
|`cam/local/`、独立`research/`|私有/独立工作区，不擅自扫描、搬迁或归档|

本次为入口、职责和状态梳理，**没有把整个未提交工作区打包成一个版本，也未删除或移动数据**。未提交工作分类与剩余清单见[工作区整理记录](docs/maintenance/workspace-review-2026-11-10.md)。

## 历史版本

[v2.0.0单摄原型](docs/releases/v2.0.0.md) · [v1.2.0发布与已知问题](docs/releases/v1.2.0.md) · [历史90题实验](docs/application/inspect-repair-full90-results.md) · [历史归档](docs/archive/README.md)

历史自动评分不是当前重访正确率、安全认证或新架构完整性证明。
