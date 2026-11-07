# 网页入口与端口

所有服务只绑定 `127.0.0.1`，不对外网开放。带“模型调用”的服务只有点击明确动作或显式付费参数后才调用；审核页不调用模型。

| 入口 | 端口 | 启动 | 模型调用 | 写入 | 用途 |
|---|---:|---|---|---|---|
| 空间记忆审核（本页） | 8892 | `npm run review:memory` | 否 | 仅 `run/<run>/web-review/reviews.jsonl` | 813 运行的分组、逐窗判断、库写入、参考标注和裁判评价 |
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

- **按组**：人工参考的一个地点访问（placeId＋时间连续段）为一组，显示组内逐窗 `identity/currentReason/windowScope`、覆盖观察数、合并/拆分、重访复用和边界滞后。
- **按窗**：95 个判断窗的候选地点、理由、**窗内逐帧原图播放器**（三摄原图、8 帧缩略图、窗头/窗尾/播放）、裁判盲取证、逐窗对照理由、裁判发现和库写入（place/visit/notes/revisions/memoryReceipt）。组页每个窗也有三摄缩略图。
- **原图浏览**：813 个观察逐帧播放，显示三摄原图、参考段/地点/可见性、覆盖窗的候选判断与裁判 verdict；可 2 秒/帧播放。这是原图审核的主入口，裁判接触图只作辅助。
- **裁判发现**：11 条 contradicted/uncertain 及引用原文。
- **原始记录**：地点、访问、笔记、资料修订、数据库 hash。
- **跳过窗**：7 个忙时跳过窗的 56 个观察；没有位置判断，原图与事实仍在库中，算覆盖缺口而不是 0 分。
- **人工审核**：对组或窗记录 `agree/disagree/unsure`＋备注，追加到 `run/<run>/web-review/reviews.jsonl`，不改生产库、参考或原图。

服务启动时校验：运行 `complete.json` 已完成、`spatial.sqlite` 的 SHA256 与裁判 bundle 绑定、参考文件与 bundle 的逐观察标注一致、裁判 `report.json` 已完成。原图与裁判接触图逐张校验 SHA256；路径必须位于对应目录内。

## 端口整理约定

- 新的审核/诊断页面优先复用现有端口，不新增一个只读页面就开一个新端口；确需新端口时在本文登记。
- 审核页只读；需要人工记录时写到新的审阅目录，不写生产库。
- 旧的标注审核/区域审核站保留用于旧数据集，不与 813 运行审核混在一起。
