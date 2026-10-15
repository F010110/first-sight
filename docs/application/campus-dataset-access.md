# 校园室内外数据：选型与许可办理

用户目标：中小型学校，室内外连通（教学楼、相似教室、走廊、楼梯、庭院/操场），可多次探索和变化。不是单栋楼面积越大越好，不将拼接小屋、复制轨迹或只有建筑外立面的城市场景当成完整校园。

## 核查结果（2026-10-15）

| 候选 | 已核实 | 尚不能保证 |
|---|---|---|
| MansionWorld / MANSION | 官方代码、数据可公开访问，论文/网页含school/high-school场景，多层场景及可编辑接口；HF固定revision `8dd4f01dbf787c3bb2eac07a48fb42b5b32ac3ce` | 学校室内外是否真正连通、操场/庭院覆盖、每栋真实可行走面积；不是已验收校园。楼层切换有scene unload/load，不能当连续爬楼摄影 |
| TartanAir V2 | 官方环境表列`Abandoned School`为Large/Mix、10轨迹；也列`Modular Neighborhood IntExt`；官网声明数据CC-BY4.0 | 废弃学校≠正常校园；已有轨迹≠可以任意生成新轨迹/移动家具，环境工程与资产许可需另核；空中轨迹不能当人的地面轨迹 |
| TartanGround | 官方有地面机器人多轨迹、front/left/right 640px90°同步方向相机，适合离线回放候选 | 指定学校场景实际可下载性、地面路径覆盖、独立会话重访及物体变化尚未验证；不能因为TartanAir有学校就断言Ground也有 |
| HM3D/HM3DSEM | 官方提供真实室内扫描及学术访问申请 | 非完整校园保证；主要室内，不能默认有室外可走道路和操场；申请通过不代表一定能筛到合适学校 |
| 自建Unity/THOR校园 | 可控制室内外、真值及变化 | 需要资产/场景制作与连通性验收，不因几何能渲染就宣称视觉真实；用户目前选择先核实MansionWorld许可，不擅自转向大规模自建 |

## 1. MansionWorld：先澄清，不是让你填写一个不存在的统一申请表

官方公开入口：
- 数据：[HF MansionWorld](https://huggingface.co/datasets/superbigsaw/MansionWorld)
- 询问：[HF New discussion](https://huggingface.co/datasets/superbigsaw/MansionWorld/discussions/new) 或 [GitHub issues](https://github.com/AgibotGeneral/MANSION/issues)
- [代码LICENSE](https://github.com/AgibotGeneral/MANSION/blob/main/LICENSE)：Apache-2.0，仅能证明代码声明，不能覆盖场景/第三方资产。

本次实际冲突：数据卡开头和结尾写CC-BY4.0，但同一个README元数据的extra_gated_prompt/extra_gated_fields要求research-only/non-commercial research；HF API gated=false。官网[license页](https://agibotgeneral.github.io/mansion-site/docs/project/license)还是TODO占位，不能用来消除冲突。未找到已有公开澄清。**公开可下载不等于我们可以忽略这些文字；也不能单凭文字冲突就断言作者一定禁止所有商业用途。**需要作者确认适用条款。

可由你本人发以下询问（未替你公开提交；不要贴API key或内部数据）：

> Subject: MansionWorld license clarification and indoor–outdoor school scenes
>
> We are evaluating persistent visual spatial memory using synchronized front/left/right RGB observations. Our preferred environment is a small or medium school campus with connected classrooms, corridors, stairs and outdoor areas. The work currently involves software prototyping/testing; possible future product use should be evaluated separately rather than assumed to be authorized academic research.
>
> 1. The dataset card declares CC BY 4.0, while its extra_gated fields mention research-only/non-commercial use. Which terms apply to the dataset and mansion_patch assets? Is a separate approval required for our use?
> 2. May we submit rendered RGB observations to a third-party cloud VLM provider for inference? Are there restrictions on provider processing or retention?
> 3. May we retain and share derived RGB trajectories, screenshots and evaluation annotations with attribution? We do not assume permission to redistribute original third-party assets.
> 4. What licenses apply to the AI2-THOR patch and inherited Objaverse/other assets? Is there a per-asset provenance/license manifest?
> 5. Which scene IDs contain a school with genuinely navigable indoor–outdoor connections? Are floors/grounds one continuous world or loaded separately? Can furniture/door states be edited reproducibly without generating new scenes with an LLM?
>
> Please identify any separate terms/approval process and the relevant school examples. Thank you.

用真实身份说明用途，不编造学校/机构。保存作者回复及许可版本，确认后先下载一栋学校及最小依赖，不整库克隆。已核实zip：场景3,123,600,013bytes＋patch827,054,435bytes，合计约3.95GB（十进制），不含解压和额外Objaverse依赖；清单/hash在`run/mansionworld-license-audit-v1/audit.json`。本轮只取公开元数据/README，未下载场景资产、未代接受条款。复核命令：`python sim/audit_mansionworld_access.py NEW-output-directory`。

## 2. HM3D：仅在用途符合时由本人申请

官方申请说明：[Matterport HM3D](https://matterport.com/habitat-matterport-3d-research-dataset)。当前官网步骤：
1. 注册/登录本人Matterport账户。
2. 右上角姓名 → Settings → Developer Tools。
3. Habitat–Matterport 3D Research Dataset → Request Access，按真实身份/机构/用途填写。
4. 阅读[数据协议](https://matterport.com/legal/matterport-end-user-license-agreement-academic-use-model-data)，官方说明仅academic/non-commercial。个人或产品原型不应自行冒充学术机构；不符合则联系官方Dataset inquiries / Contact Us申请其他使用授权。
5. 申请时另说明第三方云VLM处理、保存和可能分享派生图片的用途；不要假设下载授权自动批准所有用途。未获准前不下载受限场景。
6. 获批后token仅留本地安全配置，不贴聊天、git或可记录秘密的命令行。具体取哪种HM3DSEM版本和学校候选，批准后再核对官方文件清单。

它作为真实室内验证支线，不再作为校园室内外唯一依赖。申请并不保证有符合目标的校园。

## 3. TartanAir / TartanGround：先区分数据许可和可编辑环境许可

- [环境列表](https://tartanair.org/environments.html)、[官网许可](https://tartanair.org/)、[Ground相机/轨迹接口](https://tartanair.org/tartanground.html)。V2公开声明CC-BY4.0，应保留出处、引用、许可和修改说明；不是HM3D式学术账户申请入口。
- 仅使用已发布图像回放，与下载Unreal项目、商店原始资产、重新生成轨迹或传播可执行程序，是不同授权问题。需要这些能力时向官方维护者询问相应工程/资产许可，不能用图像数据CC-BY推定引擎项目也可任意使用。
- 优先确认少量真实地面路线及front/left/right，不按全量15–16TB示例下载。普通状态学校是否存在、室内外连接、不同会话覆盖及变化能力仍需实际看样本验证。

## 运行阻塞处理

- Habitat：已定位当前WSL用户1000不在render/video组，`/dev/dri/renderD128`和card0为0660且不可读写；`sudo -n`要求交互认证。只读报告`run/large-building-preflight-v1/habitat.json`。让本人/管理员选择给当前用户必要的设备访问（例如加入render/video组后重新登录WSL），不要chmod 777或以root长期运行模拟器；改权限后仍需重测EGL和renderer，不保证一次解决所有驱动问题。助手未改组/权限，未要求你提供sudo密码。
- 替代内核：AI2-THOR5.0 Linux64通过WSLg实际渲染同步三方向320×320图，报告`run/thor-alternative-runtime-v1/report.json`，0模型调用。只证明另一运行路线可用，不证明MANSION定制THOR包兼容，也不把FloorPlan1计作校园数据。
- 浏览器：无需等待内置desktop桥接。独立本机Chrome已实际加载三摄图、点击检索、显示两条旧证据、验证未勾选付费被拒绝，无JS异常/付费模型调用，截图`run/dev-browser-acceptance-v3/console.png`。内置bridge依旧未连接，不能称它已修好，也不是完整人工验收。

## 校园数据准入（先核对，不能只看学校名字）

1. 同一可核验世界坐标下有真实室内外通路；分层加载/瞬移/录制断档独立标记，不伪造连续运动。
2. 记录可行走面积、连通分量、房间/楼层/室外区域数量和路径长度；建筑包围盒或渲染帧数不能代替规模。
3. 教室相似性、走廊分叉、楼梯、出入口和庭院/操场有实际覆盖；既有轨迹切片不冒充不同探索。
4. 独立路线、多会话与真实可编辑变化，各自留计划/seed/动作/成功失败/证据；GT与算法图像严格隔离。
5. 检查缺纹理、黑帧、穿墙、屋顶错误机位、碰撞和路线中断；可靠性以这些验证及任务评测为准，而不以场景下载成功为准。
