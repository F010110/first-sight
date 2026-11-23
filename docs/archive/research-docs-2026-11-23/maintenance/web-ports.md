# 网页入口与端口

所有服务只绑定 `127.0.0.1`，不对外网开放。带“模型调用”的服务只有点击明确动作或显式付费参数后才调用；审核页不调用模型。

| 入口 | 端口 | 启动 | 模型调用 | 写入 | 用途 |
|---|---:|---|---|---|---|
| 空间记忆审核（本页） | 8892 | `npm run review:memory` | 否 | 仅 `run/<run>/web-review/reviews.jsonl` | 813 运行的逐观察审核：原图、位置标注、Agent 判定、库写入、裁判评价 |
| 桌面助手 / 实时回放 | 8880 | `npm run assistant:web` | 否 | 会话/日志目录 | 实时与回放共用入口，不需要切换端口 |
| 实时系统 | 8884 | `npm run realtime` | 是（需显式 `--allow-paid`） | 实时会话目录 | 真实单摄预览、记录与问答 |
| EgoLife 只读评测 | 8886 | `npm run evaluation:web` | 否 | 无 | 已保存的 EgoLife 样本与模型取证步骤 |
| 标注审核（旧 oracle 样本） | 8891 | `node dist/current/desktop/annotation-review-server.js ROOT` | 否 | `ROOT/reviews/` | 早期 UnionCity 标注样本；不是当前 813 运行审核 |
| 区域审核站（Python） | 8879 | `python sim/serve_review_site.py --directory run/review-site --port 8879` | 否 | 浏览器本地存储/导出 | val4/val5 区域审核，支持视频 Range |
| 移动试玩 | 8765 | `npm run trial:web` | 是 | 试玩记录 | 手机/局域网试玩，默认 TLS 关闭时只绑定本机 |

## 空间记忆审核页

```powershell
npm run review:memory
# 默认读取：
#   run/unioncity-memory-full813-rt-w16-batchfix2-v1
#   run/unioncity-memory-full813-rt-w16-batchfix2-judge-accepted
#   run/gmod-annotated-rerender-v2-final/sample-human-confirmed.json
```

换运行或裁判目录：

```powershell
node dist/current/desktop/spatial-memory-review-server.js `
  --run=run/OTHER-RUN `
  --judge=run/OTHER-JUDGE `
  --reference=run/gmod-annotated-rerender-v2-final/sample-human-confirmed.json `
  --port=8892
```

页面内容：

- **一次只显示一个观察**：813 个观察逐帧浏览，三摄原图（左/前/右）并排；上一观察、播放（2 秒一帧）、下一观察、拖动时间轴。
- **当前观察的四块信息**：
  - 位置数据标注：段、地点、设施、可见性、边界不确定性、参考描述；
  - Agent 判定：status、地点名/placeId、locationDecision、访问、理由、boundary、来源观察；
  - 裁判判断：identity/currentReason/windowScope verdict 和理由、盲取证窗头/窗尾、本窗确认问题；
  - 其他写入库的信息：memoryReceipt、地点、访问、地点笔记、资料修订。
- **问题导航**：`下一个矛盾`、`下一个跳过`、`问题清单`（11 条 findings＋7 段跳过观察），点击跳到对应观察。
- **人工审核**：每个观察记录 `agree/disagree/unsure`＋备注，追加到 `run/<run>/web-review/reviews.jsonl`，不改生产库、参考或原图。
- 空白证据、跳过窗和边界不确定都显式显示；跳过窗没有位置判断，不算 0 分。

服务启动时校验：运行 `complete.json` 已完成、`spatial.sqlite` 的 SHA256 与裁判 bundle 绑定、参考文件与 bundle 的逐观察标注一致、裁判 `report.json` 已完成。原图与裁判接触图逐张校验 SHA256；路径必须位于对应目录内。

## 端口整理约定

- 新的审核/诊断页面优先复用现有端口，不新增一个只读页面就开一个新端口；确需新端口时在本文登记。
- 审核页只读；需要人工记录时写到新的审阅目录，不写生产库。
- 旧的标注审核/区域审核站保留用于旧数据集，不与 813 运行审核混在一起。
