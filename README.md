# First Sight V2 · 第一视角生活助手

**当前版本：v2.0.0，单摄校园网实时原型。** 默认仅预览；独立记录；系统启动后运行空间记忆和问答；真实记录只读回放。校园网断联、单摄视野和模型错误仍是已知限制，**不是安全导航或稳定移动通信产品**。

从这里开始：[V2发布说明](docs/releases/v2.0.0.md) · [硬件—软件／前端—后端架构](docs/product/v2-system-map.md) · [V2运行手册](docs/application/v2-realtime.md) · [仓库审查与待整理清单](docs/maintenance/v2-repository-audit.md)。

## 当前运行入口

Windows开发环境需Node.js ≥22.13、`cam/.venv`中的Python依赖，以及已配对的camera-network设备。先确认电脑当前校园IPv4，与设备NVS中的上传地址一致：

```powershell
$env:CAMERA_TRANSPORT = 'push'
$env:CAMERA_RECEIVER_HOST = '电脑当前校园IPv4' # 替换为实际地址
npm.cmd run realtime
```

- 实时界面：http://127.0.0.1:8884/realtime.html
- 真实回放：http://127.0.0.1:8884/recordings.html
- 8884仅本机控制；8885在指定校园地址接收鉴权JPEG。打开实时页后启动接收器，默认不调用模型、不保存图像。
- 不设置`CAMERA_TRANSPORT=push`仍会进入旧pull模式，不要把两条链路同时启动。完整配置／端口／IP变化操作见[运行手册](docs/application/v2-realtime.md)。
- 当前通信开发暂停；后续[随身计算机＋本地存储＋蜂窝同步架构](docs/product/future-wearable-architecture.md)仅记录，不实施。

旧视频体验入口为`npm.cmd run assistant:web` → 8880；旧手机HTTPS体验为`trial:web` → 8765。它们不是V2实时主链路。[视频空间建模与问答分离](docs/product/separate-memory-and-question-runs.md)仍供历史评测复现。

## 历史v1.2结果（不可作为V2实时验收成绩）

学校样本完整连续回放：851个观察、90题，全部形成最终答案。独立上下文自动评分：

| 能力卡 | 得分 |
|---|---:|
| 实际问题解决 | 96.7 |
| 长程与干扰 | 94.1 |
| 回答可信 | 96.4 |

当前／短期／长期解决得分为 **100／93.3／96.7**。
这是开发集、同模型族自动评分，不是独立人审或安全认证。正式发布保留已知的场所误认、楼层误判、关机时段无依据断言等限制，不支持安全导航保证。

- [v1.2.0发布说明与已知问题](docs/releases/v1.2.0.md)
- [完整实测记录](docs/application/inspect-repair-full90-results.md)
- [架构与空间Context](docs/application/spatial-context-refactor.md)
- [地点轨迹人工审核](docs/application/spatial-graph-human-audit.md)

## 开发与测试

Node.js ≥22.13（本次实测Node 24）；Python工具建议使用独立虚拟环境。

```powershell
npm ci
npm run typecheck
npm test
python -m pip install -r requirements.txt
python -m pip install -r sim/school/requirements-activity-review.txt
python -m unittest discover -s tests/python -t .
python scripts/check-doc-links.py
```

构建只写 `dist/current/`，不覆盖历史冻结编译产物。测试不触发付费评测；付费命令需单独明确确认。

```powershell
python -m sim --list
python -m sim serve_review_site --help
```

完整90题运行／评分命令见[发布说明](docs/releases/v1.2.0.md)。数据与API凭据不进git；模型调用需要环境变量 `QWEN_API_KEY`、`QWEN_BASE_URL`。

## 仓库导航

| 路径 | 职责 |
|---|---|
| `cam/src/network_camera.h`、`cam/src/main.cpp` | 当前ESP32-S3单摄固件：校园认证、采集、主动上传 |
| `cam/push_stream.py` | 电脑图像接收、校验、RAM预览、按控制归档 |
| `src/hardware/` | 实时编排、输入新鲜度、方法2、SQLite及只读问题Agent |
| `src/desktop/realtime-server.ts`、`live-recordings.ts` | V2控制API、静态页、录像分段与证据读取 |
| `web/desktop/realtime.*`、`recordings.*` | V2实时界面和真实录像回放 |
| `src/agent/` | 共享空间推理／协议／模型适配，也含历史算法；非全目录默认启用 |
| `src/assistant/`、其他`src/desktop/`入口 | 历史视频应用链路，与V2实时编排不同 |
| `src/sim/evaluation/` | 当前连续评测及配套问答／评分工具 |
| `src/sim/development/` | 本地开发服务与诊断 |
| `src/sim/replay/` | 历史回放／对照实验，不是默认生产入口 |
| `sim/` | 按学校、HSSD、采集、审核、分组等分类的Python工具 |
| `tests/python/`、`tests/web/` | Python与审核页回归测试 |
| `scripts/` | 应用图像桥接、测试与运行监督 |
| `web/`其他文件 | 旧手机／视频／审核页面，保留复现，不与V2入口混用 |
| `docs/` | 当前手册、发布说明、研究与历史归档 |
| `run/`、`dist/`、`cam/local/` | 录像／实验、构建、私有配置；不进git，不修改冻结证据 |

[工具目录](sim/README.md) · [文档索引](docs/README.md) · [当前任务](TODO.md) · [整理与复现规则](docs/maintenance/repository-layout.md)

旧手机试用操作见[手机手册](docs/application/mobile-trial.md)。旧研究介绍和长篇工作日志已[归档](docs/archive/README.md)，不再作为当前版本状态。
