# HSSD备选：访问与Habitat接入

当前核查：官方[项目页](https://3dlg-hcvc.github.io/hssd/)和[Habitat数据仓库](https://huggingface.co/datasets/hssd/hssd-hab)均说明数据许可CC BY-NC4.0。HF API此次返回gated=false，公开配置HTTP可读；README仍带许可确认元信息，未来访问状态可能变化，不把当前公开访问当无许可约束。

HSSD不要求HM3D那种非商业**学术**授权，但仍仅限非商业许可条件。个人非商业评估可能适用，产品研发是否构成商业用途需用户核对；商业用途需向权利人寻求额外许可。需归属说明、许可链接、变更说明；本地审核或分享派生图片也保留许可/来源，外部云VLM处理须核对数据许可及服务商用途/留存，不默认获准。

211室内场景为官方数据规模，不是本项目已拥有211案例，更不证明其中有学校/公司大楼。当前rigid版本与新版articulated版本公开数量不同；新版注明202 articulated中161公开，其余内部test，不尝试取得隐藏测试集。20案例应以实际可用刚体场景结构为筛选基础，非住宅类型仍待核查。

核查版本：`hssd/hssd-hab` revision `4369cb9876214c7fbebcf552eb532380e4d287e4`，约75560仓库文件。不要直接git clone整个资产库：先读取场景/区域元数据，筛选20候选，然后下载对应stage、object config、mesh、语义引用等完整依赖；缺资产不能用空房间冒充原场景。下载应固定revision、保存hash与许可来源，可断点续传。

本机Habitat0.3.3的公开场景GPU渲染已验证。`sim/habitat_render_smoke.py --dataset-config`现支持HSSD SceneDataset配置与场景ID，navmesh构建包含静态物体；只准备了入口，尚未下载HSSD网格或验证HSSD实际渲染。

```powershell
wsl -d Ubuntu --cd /mnt/d/Projects/Projects2026/VLM -- env GALLIUM_DRIVER=d3d12 MESA_D3D12_DEFAULT_ADAPTER_NAME=NVIDIA run/habitat-runtime/env/bin/python sim/habitat_render_smoke.py SCENE_ID run/hssd-smoke-NEW --dataset-config run/hssd-data/hssd-hab.scene_dataset_config.json --egl-default-device
```

用户先确认非商业用途或额外许可；若页面要求许可确认由用户本人完成，不需要Matterport账号，不发送Token到聊天。随后按固定来源批量筛选20结构不同案例、下载依赖与试渲染，再做轨迹/固定样本/审核网站和test.5推理，不将数据源试验说成新案例已完成。
