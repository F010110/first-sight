# 评测执行监督

从仓库根目录执行。不会由构建／单元测试自动调用。

- `run_release.ps1 -OutputDirectory NEW-RUN`：当前v1.2.0完整90题＋独立评分；真实付费入口，运行前须用户授权并配置API和本机开发数据。
- `run_inspect_candidate_full.ps1`：共用监督器；默认使用历史冻结候选编译目录，可显式指定当前编译路径。
- `watch_interleaved_run.ps1`：对已有PID独立记录心跳；宿主整体退出时心跳也会停止，不能保证自动恢复。
- `run_interleaved_budget16.ps1`：此前预算对照的历史执行入口，不作当前正式版启动入口。

日志放`NEW-RUN-lifecycle/`；失败不覆盖原运行，不静默从旧Context恢复。
