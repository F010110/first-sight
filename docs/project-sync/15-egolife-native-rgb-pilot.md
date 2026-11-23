# EgoLifeQA：原生First-Sight RGB先导评测

## 本次范围

用户明确要求不再用文本替代实现，并通过资源确认授权：下载官方前10题所需完整视频前缀（1.74GB，上限1.8GB），2秒采样，将真实图像交给现有Qwen API，建忆、问答、重试合计费用估计上限USD5。既有“仅本地预览”数据不作为云端授权依据。

本轮不是LightMem对照，不使用其caption、transcript、语义图或答案作为运行时输入，也不沿用14号报告的40%文本适配器成绩。

## 原生系统入口

`src/evaluation/run-egolife-native.ts`直接导入：

- `RealtimeMethod2`：与`src/hardware/realtime-session.ts`实际实时会话相同的单摄建忆组件；真实perception、scope、候选选择、原图比较调用。
- `RealtimeMemory`：实际归档/判断SQLite及因果快照。
- `answerRealtimeQuestion`：实际历史search → inspect原图 → answer，不另写检索器，不更换提示词算法。
- `spatialJsonVlm`：项目现有Qwen图像请求适配器。建忆和问答共用一个全局预算实例。
- `egolife-first-sight-adapter`：只转官方题目、选项、源时间及最终字母协议，拒答/错误分别存储。

这是当前工作树的实时单摄实现，不冒称冻结v2.1.0或项目所有历史实现。运行前记录实际核心源文件hash；没有改生产建忆和问答算法。

## 输入与评分

- 选择官方按源时间排序前10题，ID1–10，不按预测、答案位置、证据是否容易筛题。
- pinned EgoLife revision `143fb319be7aa5ae210c936bf4f0f3a86092afb0`。
- DAY1首个发布片段11:09:42.08开始，连续输入至第10题12:17:27.18；136段，总1,744,496,614字节。源文件按公开LFS SHA256逐个校验。
- 完整解码原片，按实际PTS约2秒采样。先缩放/补边为VGA JPEG（不裁剪），再调用原生`cam/host/prepare_live_image.py`产生像素校验PNG和单摄72维descriptor。不是占位图或复制视角。
- 原片保留发布版本的烧录文字/人物标识；没有人为添加身份标签。
- 题目允许看到的图像与判断均按发问截止时刻过滤。未到时刻的帧不会提前交给建忆组件。
- 输入不提供语音转录；需要音频或人物身份的官方题也保留。因此分数属于**单摄RGB输入轨**，不等于完整多模态EgoLife成绩。
- 回放保留真实`LiveFramePolicy`容量1最新帧队列，所有2秒采样原图归档，但模型忙时旧待处理帧被原队列覆盖，不强制所有归档帧做全组比较。实测建忆服务耗时推进源时钟，仅空闲等待快进；判断在完成时刻可用，不能在拍摄时刻提前出现。
- QA在回放后读取各题截止时刻的因果快照，不模拟问答与建忆并发时的供应商争用，因此也不是完整端到端实时吞吐测试。
- 所有10题固定计入分母。拒答、协议失败、建忆中断或预算耗尽均记录，不仅统计成功题。
- 评分时才解析已冻结gold；推理组件不接收gold、target_time、reason或keywords。

## 启动命令与硬边界

```powershell
.venv/Scripts/python.exe -X utf8 scripts/evaluation/prepare-egolife-native.py --output run/egolife-native-rgb-input-v1 --authorize-public-video-download-and-qwen-upload
node --use-env-proxy dist/current/evaluation/run-egolife-native.js run/egolife-native-rgb-input-v1/native-input.json run/egolife-native-rgb-input-v1/gold.json run/egolife-native-rgb-results-v1 --confirm-paid
```

下载不自动重试，不覆盖目录。真实推理使用现有受限网络/协议重试；全部计入同一USD5估计上限及12000次请求上限。预算是项目已有单价估计，不是供应商实际账单。不会自动增加预算、重新启动失败实验或更换题目。

结果输出将包含`frozen.json`、`public-input.json`、`memory.sqlite`、逐次requests/usage、`build-progress.json`、逐题`results.json`、`scored-results.json`及`summary.json`。目前准备进程已启动，尚无原生成绩。

## 运行前检查

构建通过，14项相关TypeScript测试通过。使用已有视频仅做本地解码检查：30秒片段提取15帧，PTS为0、2、…、28秒；原生VGA图像准备与72维descriptor通过，无API调用、无上传。这些是工程检查，不是benchmark准确率。

## 下载阶段中断及有界恢复

初次下载因Python urllib的TLS EOF中断，模型尚未启动。保留已下载文件；显式记录一次`--resume-verified-downloads`续取，核验已完成文件SHA256后复用，只下载缺失文件。该次续取改用curl传输，不自动重试；同一136段源、题目、1.8GB上限及USD5模型上限不变。部分或损坏的已有文件不覆盖，遇到即停止并保留。恢复收据为输入目录的`explicit-download-recovery.json`。

该次curl续取仍因Schannel TLS握手失败停止。重新清点为**45/136段有效**（此前沟通中“46”计数不准确），没有部分文件，剩余91段、1,145,043,352字节。用户随后明确要求继续下载，并允许调查本机代理或提供网页下载办法。

检查发现HTTPS_PROXY/HTTP_PROXY均指向`127.0.0.1:7897`。同一缺失片段的只读HTTP探针：经代理HTTP200、约1.4秒；直连10秒连接超时。该结果只支持保留代理，并不能证明所有偶发TLS错误的确切根因；未修改系统代理或关闭证书校验。

新增`scripts/evaluation/download-egolife-native.py`，按新授权改为**串行、每缺失文件最多2次尝试**，每次前预留字节预算、失败部分文件保留；累计已知字节包括失败尝试不超过原1.8GB。所有文件仍逐一校验原LFS SHA256，已校验文件不重下。状态保存在`serial-proxy-recovery/ledger.json`，不是不受限重试。新4项下载完整性及浏览器清单测试通过。

同时输出`browser-download-links.html/.csv/.json`和`DOWNLOAD-HELP.md`。支持`--import-dir`从用户浏览器下载目录按原源文件名导入，通过hash才复制，不删原件。可用`--prepare-verified-only`将已完整下载的同一前缀交回原生准备流程，避免重新触发网络。

## 下载已完成，进入本地准备

串行代理续取成功，**136/136段完整校验通过**、缺失0段，总计1,744,496,614字节；两次TLS握手失败均在第二次成功，失败没有留下响应体，累计已知传输量仍在1.8GB内。无需用户再手动下载。完整收据见`serial-proxy-recovery/summary.json`及ledger。

已启动`--prepare-verified-only`进行无网络本地准备。启动前确认Node v24.21.0支持进程级`--use-env-proxy`；Qwen凭据由环境继承，项目根目录并不存在`.env`，因此更正上面的启动命令，不创建/打印凭据。不会修改系统代理。

回放接入补上实际最新帧队列，并新增2项调度测试：服务耗时造成帧覆盖、判断完成时刻而非观察时刻可见；producer失败后原图归档仍独立保留。相关TypeScript测试共16项通过。该修正发生在首次原生付费运行之前，不是看到分数后改变算法或重跑。

## 原生运行已启动

本地准备成功生成**2033帧**原生JPEG/PNG及72维单摄特征，无检测到的采样断档。输入hash：`3efd0ba2abb4454b7f51e8efbbcc9cd2db41144b4bf9a37224aadc27cb54dc17`；官方QA源hash保持不变。

已按上面的`node --use-env-proxy ... --confirm-paid`命令启动首次真实运行，结果目录`run/egolife-native-rgb-results-v1/`，不另建第二轮或增加预算。此前“尚无成绩”仍成立，完成后以该目录`summary.json`为准，不使用14号文本实验替代。

官方前10题分布为EntityLog5、RelationMap2、EventRecall1、TaskMaster2，不含HabitInsight；3题标注需要音频、9题标注需要人名。源视频发布版可见烧录信息，但不另行注入名字或转录。这是起始前缀先导，不是500题全量或五类均衡成绩。
