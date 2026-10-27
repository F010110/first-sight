# GPU 通过与 FindingDory 环境搭建

## GPU 验证通过

用户已在 WSL 为 helele 添加 render/video 组，当前会话生效。使用：

```powershell
wsl -d Ubuntu -- env GALLIUM_DRIVER=d3d12 MESA_D3D12_DEFAULT_ADAPTER_NAME=NVIDIA /mnt/d/Projects/Projects2026/VLM/run/habitat-runtime/env/bin/python -B /mnt/d/Projects/Projects2026/VLM/research/scripts/habitat_smoke.py --egl-default-device
```

退出码 0，Habitat-Sim 0.3.3；实际 GL renderer 是 `D3D12 (NVIDIA GeForce RTX 4060 Laptop GPU)`，softwareRenderer=false。尽管 stderr 含 EGL fallback 警告，最终上下文不是 llvmpipe。三个方向均渲染出有效深度。证据：`habitat-smoke-20261025T110657Z.json`。

这只验证合成立方体渲染，不是 FindingDory episode、物理交互或惯性实验。

## 原版环境进行中

`scripts/bootstrap_findingdory.sh` 已启动，安装独立 Python 3.9 / Habitat-Sim 0.3.1 headless+Bullet，不修改现有环境。求解已通过；脚本保存求解清单、安装日志、显式包清单，并尝试在该环境执行 GPU 冒烟。后续以脚本退出状态和报告为准，不能把启动视为完成。

FindingDory 的 Habitat-Lab 子模块已通过 HTTPS 下载，固定为上游 gitlink：`904743e40437242065f800e33685ef483001d4a2`；未切换到最新版、未执行上游 setup.sh。

## 数据容量核查

已查询公开 HF 元数据，无需凭据、未下载完整数据。对应 sha、文件列表和许可元数据见 `dataset-metadata-20261025T110832Z.json`。

| 数据仓库 | 已知文件体积（十进制，未解压） |
|---|---:|
| yali30/hssd-hab | 13.39 GB |
| ai-habitat/OVMM_objects | 1.34 GB |
| yali30/findingdory-habitat | 1.01 GB |
| yali30/findingdory | 32.51 GB |
| Baymax-12/SpaceLocQA | 44.78 GB |

这些仓库不能不加区分地全部下载。优先检查 FindingDory habitat episode 对应场景与对象，按最小资产闭包获取；仓库 ungated 不等于无需遵守许可证。离线原始历史数据与仿真资产的需求应分别核查，避免将可选视频重复下载。当前无完整数据集下载、无模型付费调用、无正式基线成绩。
