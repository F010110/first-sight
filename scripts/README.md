# 工具脚本导航

本目录只放导航和功能子目录，不再接受散落的独立脚本。所有命令在仓库根目录运行；迁移不保留旧路径包装脚本。

|目录|用途|使用边界|
|---|---|---|
|`testing/`|TS测试调度、文档链接、浏览器与实时历史检查|优先使用npm test／npm run test:docs；history检查需要显式付费确认，不属于默认测试|
|`maintenance/`|本地产物索引、一次性目录迁移|索引会写本地INDEX；迁移脚本只供记录与审查，禁止重复运行|
|`media/`|视频抽帧、图像变化／匹配／重叠、场景读取|按工具参数读写指定产物；scene_reader／analyze_frames可调用外部模型，非默认测试|
|`datasets/`|HSSD数据导入与来源标注|仅准备数据，不把来源辅助标注当独立人审真值|
|`spatial/`|空间候选特征、访问拓扑、原始输出审查与对比诊断|读取指定实验；写独立分析产物，不覆盖原始响应|
|`review/`|原图审核资料生成、已有结果预览服务|审核／可视化，不作为V2实时服务|
|`evaluation/`|方法2、重复批次、评分、历史评测PowerShell入口|模型运行与评分分开；运行须显式付费确认，历史脚本不自动续跑|
|`network/`|旧手机局域网TLS准备|历史工具，会改变本地证书配置；当前暂停，不是V2必需启动步骤|

## 常用入口

空间记忆研究的当前状态以[TODO](../TODO.md)为准，不以历史V2入口替代：

|入口|输入/输出与副作用|
|---|---|
|[ULVN匹配说明](media/ULVN-MATCHER.md)|隔离Python3.11；首次下载权重，本地GPU推理；不调用付费VLM|
|`src/sim/evaluation/run-spatial-memory.ts`|耐久连续空间服务运行器；原始public input→新run目录，须明确付费确认|
|`src/sim/evaluation/repeat-revisit-probe.ts`|冻结Context诊断，有界付费调用；不是持久Session全链路|
|`evaluation/diagnose-revisit-backend-probe.py`|只读指定实验，stdout输出轨迹核查，不联网、不付费、不自动改分组|

脚本文件存在不代表当前默认启用；不要批量执行evaluation/datasets下的所有工具。

```powershell
npm.cmd test
npm.cmd run test:docs
python -m unittest tests.python.test_v2_repository_layout
cam/.venv/Scripts/python.exe -m unittest discover -s cam/host -p "test_*.py"
```

`testing/check-compact-live-ui.cjs`使用mock API，不切换真实系统。其他UI检查可能连接运行中的服务，先阅读脚本，不能把testing目录中所有文件当作无副作用测试批量执行。

硬件主机侧脚本在[cam/host](../cam/host/README.md)，离线Python研究工具仍由`python -m sim --list`登记。当前工具文件清单与职责由本索引、各目录和[迁移清单](../docs/maintenance/v2-layout-map.json)共同定位；不要另造同名包装入口。

新增工具须选择目录、说明输入／输出和是否可能联网、付费、改变设备或进程。测试放tests或邻接源码；运行数据、凭据、录像、模型原始响应不得写入scripts。

`datasets/collect-realism-sources.py`收集官方来源快照，按显式选项取得ReplicaCAD和少量EgoLife原始样本；会联网并写新datasets目录，220MiB资产规划上限，不付费、不运行模型。详见[来源核查](../docs/research/realistic-sample-source-survey-2026-10-24.md)。
