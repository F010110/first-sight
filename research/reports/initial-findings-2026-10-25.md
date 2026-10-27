# 初轮实际检查结果

## 后续纠正：软件渲染绕行已通过

最初将设备权限描述为整个渲染流程的阻塞不够准确。项目已有软件渲染绕行记录，本次复测通过：

```powershell
wsl -d Ubuntu -- env LIBGL_ALWAYS_SOFTWARE=1 EGL_PLATFORM=surfaceless /mnt/d/Projects/Projects2026/VLM/run/habitat-runtime/env/bin/python -B /mnt/d/Projects/Projects2026/VLM/research/scripts/habitat_smoke.py --egl-default-device
```

退出码 0；Habitat-Sim 0.3.3；llvmpipe CPU renderer；前／左／右 RGB-D 均通过脚本检查。报告：`habitat-smoke-20261025T081349Z.json`。未修改权限或系统配置。D3D12 环境变量方案本次仍失败；GPU EGL 加速尚未解决。软件渲染可以支持后续正确性小样，不能作为 GPU 性能结果，也不代表 FindingDory 0.3.1 官方环境或基线已复现。下述“两次失败”及“当前结论”是初次探测的历史记录，以本节更新为准。

## 环境

- Windows + Ubuntu WSL2；GPU：RTX 4060 Laptop，8188 MiB，驱动 566.26。
- 检查时 D 盘剩余约 138 GB（十进制），C 盘约 102 GB；并非承诺这些空间均可用于实验。
- Windows 项目 Python 缺少 Habitat、PyTorch 等。
- 只读复用 `run/habitat-runtime/env/bin/python` 做探测，未安装或修改其包。WSL 可找到 Habitat-Sim、NumPy、Pillow；缺少 Habitat-Lab、Habitat-Baselines、torch、Hydra、OmegaConf，以及各基线主要依赖。
- 探测详情：同目录 `environment-*.json`。

## 实际渲染尝试：失败

命令（仓库根目录 PowerShell）：

```powershell
wsl -d Ubuntu -- /mnt/d/Projects/Projects2026/VLM/run/habitat-runtime/env/bin/python -B /mnt/d/Projects/Projects2026/VLM/research/scripts/habitat_smoke.py
wsl -d Ubuntu -- /mnt/d/Projects/Projects2026/VLM/run/habitat-runtime/env/bin/python -B /mnt/d/Projects/Projects2026/VLM/research/scripts/habitat_smoke.py --egl-default-device
```

1. 默认模式退出码 1：`unable to find CUDA device 0 among 2 EGL devices`，`Unable to create windowless context`。
2. 默认 EGL 设备模式退出码 1：`/dev/dri/renderD128`、`/dev/dri/card0` permission denied，`EGL_NOT_INITIALIZED`。

错误发生于 C++ 渲染上下文创建，会直接终止 Python，因此该两次尝试没有生成 `result.json`；空 runs 子目录不代表成功。此处保留人工记录的实际输出，不伪造脚本产出的报告。

尚未改变 WSL 权限、用户组或 GPU 配置；识别 GPU 不等于 GPU 渲染可用。下一步先诊断当前用户／设备权限与 EGL 设备映射，再决定隔离 Linux 环境；不默认用软件渲染成绩冒充 GPU 性能。

## 源码准备

四仓库浅克隆成功，精确 commit 见 `source-audit-20261025T080155Z.json`。已执行宿主 Python AST 静态解析，无语法错误；**不是导入成功、依赖可用或论文复现成功**。未初始化子模块、下载模型或数据，未运行上游安装脚本。

- FindingDory：官方 `setup.sh` 使用 Python 3.9、Habitat-Sim 0.3.1 withbullet/headless；Habitat-Lab 为作者 fork 的子模块，URL 使用 SSH。实际搭建应保留 gitlink commit，仅转换传输为 HTTPS，不能用最新版 Habitat-Lab 替代。额外依赖包括 PyTorch3D、FlashAttention，8 GB 显存需实测而非假定足够。
- 官方数据脚本涉及 HSSD、OVMM 对象、FindingDory 数据及机器人资产；还含禁用证书校验的 HTTP 下载。未执行该脚本；应逐项核查许可、容量、HTTPS 来源和完整性后下载。
- 3D-Mem：官方 A-EQA 配置需要 HM3D 及问题文件、YOLOWorld、SAM 与后端模型。首轮需先确认合法可用资产与显存预算。
- Meta-Memory：依赖 Milvus、LangChain/LangGraph、模型及 API。requirements 中存在固定旧版与未固定新版混用的解析风险，尚未进行依赖求解，不能断言一定冲突。
- GraphEQA：源码已固定，完整 Hydra／场景依赖与运行验证仍待完成。

## 接下来实际执行顺序

1. 排查 WSL 渲染失败，确保三视图 RGB-D 冒烟成功并记录真实 GL renderer。
2. 在 `research/envs/` 创建独立 FindingDory 环境，锁定其 Habitat fork；不污染已有环境。
3. 核查数据目录、容量和许可，取得最小合法场景／episode，再运行官方加载器与官方基线。
4. 分别建立 3D-Mem、Meta-Memory 环境及最小原生样例；模型付费调用和大规模下载启动前记录预算。
5. 原生流程通过后，才实现统一 FindingDory 适配及三摄／误差实验。

当前结论：完成环境探测与基线源码准备；渲染冒烟失败，**零个官方 episode、零个已复现基线成绩**。没有进行任何 IMU 鲁棒性实验。
