# 大楼数据许可与Habitat渲染准备

## 许可：需本人完成，不由助手代签

### HM3D

- [官方申请说明](https://matterport.com/habitat-matterport-3d-research-dataset)：本人注册Matterport，Settings→Developer Tools→Habitat-Matterport 3D Research Dataset→Request Access，填写真实姓名/邮箱/机构/用途。
- [数据协议](https://matterport.com/legal/matterport-end-user-license-agreement-academic-use-model-data)：限非商业学术用途，数据及衍生信息的非学术用途需另获书面同意；分发、归属说明、接收者协议等另有义务。不是“免费就可用于个人产品”，若本项目不符合应申请额外许可或换源。
- 当前Qwen云端API会上传渲染图；审核网站/导出/发布也涉及衍生数据与分发。是否许可这些用途需本人核对或书面询问，不能默认数据下载批准同时批准公开网页和第三方云处理。
- 获批后本人在Developer Tools生成API token，ID/secret仅本地安全配置，不贴聊天，不进git、日志或命令行示例。官方下载器通过命令参数传secret，实际接入应避免进程列表暴露，不能简单记录完整下载命令。
- 先下载获准的最小分集/场景索引用于挑选20案例，不直接拉全量。minival仅小分集，不保证含学校/办公类型。

### Stanford 2D-3D-S

- [官方仓库](https://github.com/alexsax/2D-3D-Semantics)链接的[旧表单](https://goo.gl/forms/2YSPaO2UKmn5Td5m2)当前明确提示已迁移，**不必继续提交旧表单**。
- 当前入口：[Stanford Redivis 2D-3D-S](https://sdss.redivis.com/datasets/f304-a3vhsvcaf)。本人登录并核对最新访问条件；旧表单注明非商业学术用途、禁止再分发，完整条款另见其链接，不能以仓库Apache软件许可覆盖数据。
- 不伪造学术机构，未确认符合许可前不下载/上传到Qwen/发布视频。若需个人产品研发，应向数据作者核实额外用途或改选适用来源。
- 大小参考旧README：noXYZ约110GB、完整约766GB，按区域/网格最小必要下载，当前迁移入口实际文件大小和授权以新页面为准。

## 隔离渲染环境

本机WSL Ubuntu x86_64，GPU RTX4060 Laptop 8GB可见；系统Python3.14，无Conda/Habitat。不修改EAM THOR venv。官方当前文档建议Python3.12，但Anaconda实际稳定headless Linux包0.3.3为Python3.9，因此采用可取得的固定组合，而非假称3.12包已验证。

`sim/setup_habitat_environment.py`在git忽略的`run/habitat-runtime/`下载micromamba，隔离安装Python3.9/Habitat-Sim0.3.3 headless/numpy<2/imageio-ffmpeg，只用conda-forge/aihabitat，不用Anaconda defaults。bootstrap hash与显式包清单本地保存，不下载受限数据。

```powershell
wsl -d Ubuntu --cd /mnt/d/Projects/Projects2026/VLM -- python3 sim/setup_habitat_environment.py
wsl -d Ubuntu --cd /mnt/d/Projects/Projects2026/VLM -- env GALLIUM_DRIVER=d3d12 MESA_D3D12_DEFAULT_ADAPTER_NAME=NVIDIA run/habitat-runtime/env/bin/python sim/habitat_render_smoke.py run/habitat-assets/skokloster-castle.glb run/habitat-smoke-NEW --egl-default-device
```

已取得公开Habitat测试资产The King's Hall（Skokloster Castle），约38MB，校验官方HF文件SHA256。Habitat README列其CC BY4.0，作者Skokloster Castle，来源/许可/归属记录存`run/habitat-assets/attribution.json`。这是环境测试，不是学校/办公数据授权，也不计20正式案例。

GPU实际验收：生成左/前/右320px90°FOV三图（留缝），检查非空、可行走网格，输出图像/hash/报告。安装import成功不等于GPU渲染成功；WSL headless EGL可能需驱动/库适配，失败记录，不回退软件渲染后冒称GPU验收。

官方Habitat README目前注明v0.3.4之后Meta内部不再正式活跃维护，故固定版本、记录包锁，不跟随nightly。完整批采集、学校/办公网格导入、连通路线与网站转换在环境冒烟及许可完成后实施。

## 当前状态

- 隔离安装完成，Habitat0.3.3导入通过；WSL默认CUDA→EGL匹配失败。显式默认EGL选择并指定Mesa D3D12/NVIDIA后，实际GL renderer为`D3D12 (NVIDIA GeForce RTX 4060 Laptop GPU)`，不是llvmpipe。
- GPU三视图实际渲染与图像查看通过，报告`run/habitat-smoke-v5/report.json`；navmesh加载，可导航面积约565平方米，3图320×320，有效室内大厅图像。环境可渲染不等于20场景采集器/轨迹验收完成。
- 失败保留：v1接口Vector3类型不匹配；v2默认CUDA/EGL错误；v3显式EGL得到llvmpipe软件渲染；v4GPU渲染成功但随机navmesh点落在不合适上层表面，画面大面积空白，不作为有效样本。v5选下层中心候选后图像正常。批量场景需排除屋顶/扫描外部/空洞和不合适机位，不能仅navmesh+非零方差当采集有效。
- 公开测试资产hash通过，受限大楼数据未下载、未申请/代签许可。
- 下一步需用户说明本项目是否符合非商业学术用途并本人办理访问；不符合则先取得书面许可或调整来源。
