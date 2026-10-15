# 模拟器空间记忆开发台（v2开发版）

只在电脑模拟器开发环境使用，独立于`trial-server`与实际产品网页。没有语音、输入框聊天或设备采集。v1冻结规格与哈希不变。

## 启动

```powershell
npm run build
python sim/build_long_term_dataset.py sim/long-term-pilot-spec.json run/my-simulator-dataset
node dist/sim/spatial-dev-server.js run/my-simulator-dataset run/my-dev-memory 3417
```

打开`http://127.0.0.1:3417`，不要换localhost主机名。输出目录须新建，避免覆盖；已有同数据集工作库可重启继续。数据源路径依赖本机已有HSSD素材，不是自动下载命令。其他建筑可用`long-term-three-building-spec.json --building ID`单独导出，每建筑独立库，防止跨世界误关联。

1. 选择录制和观察查看前/左/右图。
2. 逐观察入队（仅保存，不调用模型），勾选允许付费后处理最早4观察。这里是确定性手动回放，不是连续在线相机。
3. 查看状态、分页归属、最近6节点，选节点查看访问和转移证据。
4. 恢复历史只允许早于所选观察；可继续翻页查看非代表原图。切换观察会重置游标。
5. 预置重访/差异任务触发RequestAgent（无自由文本输入），变化Agent要求所选观察已经赋予地点身份；未知/无旧证据不比较。只比较同一相机front。
6. 在测试库确认/合并/拆分/撤回；不改旧离线图。节点下拉目前是有限近期目录，不是全部地点浏览器。

付费模型读取环境中的QWEN_API_KEY/QWEN_BASE_URL，不在页面输入或返回秘密。v2模拟器Agent固定qwen3.8-flash且payload明确enable_thinking=false；产品旧调用默认不变。开发服务单操作在途，不启动自动后台付费。刷新不会调用模型，操作结果逐项另存workspace/event-*.json。

## 检索与Agent

`SpatialRetriever`只读v1 SQLite。查询由可信服务固定截止时间/可选录制；模型不能扩大权限。关键词是观察判断理由上的AND子串匹配（不使用可泄露未来事实的当前摘要），可按地点和时间过滤。无匹配返回unknown；恢复原始观察，而不局限首末代表。按seq游标分批，最多24条/次、12次search、最多24图/查询（默认8）。inspect只能读取本次返回过的ID，按实际相机张数扣预算，引用必须已inspect。历史输出反映**当前纠正后的身份标签**，不是过去修订版本的数据库快照。

RequestAgent真正工具循环search→inspect→回答。历史问题非拒答必须有已看图引用，工具错误不升级成事实。最多8轮、120秒，第6工具轮后移除工具要求最终答复；总API输入仍会重复历史图，图片预算不等于总图像计费数。日志记录token/调用/耗时，不声称固定成本。

变化桥接从当前已赋地点取严格更早的同地点观察，读取预算通过后把可信front路径给原SceneChangeAgent，重建内存基线，像素配准/语义判断保留原有保守逻辑。没有足够同视角/遮挡证据时也可能无法判断，不允许从未看见推断移走。

比较结果保存在独立`changes.sqlite`（不改冻结v1 schema），有当前/基线观察ID、地点、录制、时间和完整判断。同一观察对重复执行不覆盖原结果。Request检索可读历史变化候选，仍须恢复原图确认，不能把事件摘要当当前状态。地点修订暂不自动重写旧变化事件的原身份标签，需要后续身份映射增强。

本轮先完成词法/时间/路径检索及原图恢复。**尚无视觉向量或跨语言检索**；短词SQL可能扫描历史磁盘，内存/返回预算有界不代表延迟亚线性。地点识别仍是冻结v1的近期/邻居候选，未擅自改成用GT召回；新增retrieve先接Request/变化Agent。历史路径仅返回单录制实际观察序列，未知打断，不等于导航规划成功。

## 数据与评测

`build_long_term_dataset.py`消费真实三摄capture，不重复粘贴路线。五种角色为initial/alternate-route/similar-area/changed/memory-task；报告缺失角色与未走完整路线。changed必须有可编辑标记及实际干预清单，静态HSSD不伪造变化。每建筑只属一个split。公开文件仅图像/时间/录制ID，GT和任务答案在evaluation-only，服务不读取、不提供路由。媒体按SHA256复制，保留素材来源/固定revision/许可。现有collector区域标签只是暂定评测标签，非人工确认房间真值。

`evaluate_long_term_memory.py dataset predictions.json`校验任务证据不越时间/建筑，报告Recall@K、覆盖、调用/token/时延。未测的导航成功、视觉回答正确、变化和过时记忆率明确标未测，不能用0或检索指标替代。HM3DSEM授权/真实资产、大楼新路线及可编辑变化数据仍需另行验证。

## 回归

```powershell
npm run test:long-term-memory
python sim/test_spatial_dev_http.py
python -m unittest discover -s sim -p test_long_term_dataset.py -v
python sim/test_long_term_memory_freeze.py
```

小额真实模型接入测试（会调用付费API，结果目录必须新建）：

```powershell
node dist/sim/spatial-dev-smoke.js run/my-simulator-dataset run/my-smoke-result --confirm-paid
```

其同房间样本不代表新轨迹泛化。真实模型失败、预算中断均保留独立结果，不能只留下成功轮次。桌面浏览器未连通时HTTP通过也不宣称视觉交互验收。

## 本轮真实结果

- `run/long-term-dev-real-smoke-v2/`、`...-traced/`保留两次Request工具循环达到预算的失败；后者逐轮记录发现跨语言词法未命中、9图超过8图预算及猜测ID被拒绝。不是吞掉异常后的成功。
- 加入第6工具轮后移除工具的收口；`...-finalization/`同房间查询实际读取两条旧观察，7次Request模型调用、16632tokens、16.866秒，引用通过。变化Agent用2000ms旧front对4000ms当前front，配准仅8inliers不足阈值，VLM fallback判断未变化。此为小样本连通，不是物体变化准确率验证；随后新增的变化审计库另由无模型回归覆盖。
- 初始3观察写入调用日志保留在第一结果目录，后续复测从已关闭DB独立复制，未重复付费建记忆；上述tokens只计最终Request，不是所有失败/拓扑/变化调用总费用。
- 3建筑已有初探118三摄观察已打包`run/long-term-three-building-pilot-v2`，尚无独立跨会话任务。3次新路线渲染尝试均EGL_NOT_INITIALIZED（包括surfaceless和显式系统Mesa/WSL库路径），失败目录保留。未降低为黑图或软件假数据。
