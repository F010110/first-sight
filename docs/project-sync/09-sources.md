# 来源与复核入口

以下路径相对仓库根；尽量指向原始证据，不复制大型工件。

## 当前主线

- `docs/product/fixed-pose-route-assistant-v1.md`
- `src/agent/{pose-route-topology,fixed-pose-route-assistant,route-description-agent}.ts`
- `src/agent/pose-route-topology.test.ts`
- `scripts/datasets/prepare-fixed-pose-routes.py`
- `src/evaluation/fixed-pose-routes.ts`
- `datasets/fixed-pose-routes-p0006-v1/{input,gold,frozen}.json`
- `run/fixed-pose-routes-p0006-geometry-v1/report.json`
- `run/fixed-pose-routes-p0006-narration-v1/{report.json,report.md,graph.json,language-review.json,requests/usage.json}`

## 旧题集与固定实验

- `docs/product/tartan-route-qa-v1.md`
- `scripts/datasets/build-tartan-route-qa.py`
- `scripts/evaluation/tartan-route-qa.py`
- `src/evaluation/tartan-route-qa.ts`
- `tests/python/test_tartan_route_qa.py`
- `datasets/tartan-route-qa-p0006-v2/{public.json,gold.json,frozen.json,questions-and-answers.md,review.jpg}`
- `run/tartan-route-qa-qwen-minimal-v1/{manifest.json,report.json,report.md,requests/usage.json}`
- `docs/product/spatial-protocol-repair-expanded-20261027.md`
- `docs/product/tartanground-p0006-spatial-preparation.md`
- `run/spatial-fixed-evaluation/2026-10-27T10-11-15-752Z-3cf087e3/{frozen.json,events.jsonl,predictions.json,stopped.json,requests/usage.json}`
- `run/spatial-repeat-batches/tartanground-method2-protocol-repair-20261027-v2/`

## 历史、产品与数据

- `TODO.md`（顶部最新工作，下面有历史条目，不要按“已启动”字样自动续跑）
- `docs/product/spatial-method2-fixed-and-graph-diagnosis-v1.md`
- `docs/product/spatial-candidate-recall-and-topology-v1.md`
- `docs/product/vlm-imu-spatial-memory-closed-loop.md`
- `docs/product/ideal-pose-route-experiment-v1.md`
- `research/reports/spatial-memory-paper-code-audit.md`（只读引用，研究树不改动）
- `docs/releases/v2.1.0.md`
- `docs/product/v2-system-map.md`
- `docs/application/v2-realtime.md`
- `docs/research/{tartanground-trajectory-screening-2026-10-27,ute-p01-p04-review,realistic-sample-source-survey-2026-10-24}.md`
- `docs/application/inspect-repair-full90-results.md`（历史生活助手成绩，非当前Tartan成绩）

## 非付费复核命令

```powershell
git log -1 --format="%H %s"
git rev-parse "v2.1.0^{commit}"
git status --short
npm.cmd test
.venv/Scripts/python.exe -m unittest tests.python.test_tartan_route_qa

# 旧题集只重算分数，不推理：
.venv/Scripts/python.exe scripts/evaluation/tartan-route-qa.py score datasets/tartan-route-qa-p0006-v2 --output run/tartan-route-qa-qwen-minimal-v1

# 当前图的纯程序检查；必须新建输出目录：
node dist/current/evaluation/fixed-pose-routes.js datasets/fixed-pose-routes-p0006-v1 NEW-OUTPUT

# 更新同步区的文件清单，不读取密钥目录或research内容：
.venv/Scripts/python.exe scripts/maintenance/update-project-sync-catalog.py
```

这些是操作参考，本次整理未运行新推理/硬件实验。复核前确认本机工件齐备、工作区状态及用户授权范围。
