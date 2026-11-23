# 长真实录像回放

入口为8884的 `/recordings.html?source=real`。真实原片与本机相机记录共用选择列表，但采用不同播放方式：原片使用浏览器原生视频控件，另有整段累计时间轴，可跨原始分片跳转；没有模拟专用的“跳过停顿”，也不补左右视图。原片自动顺序切换可能短暂缓冲，不宣称无缝重编码视频。

首轮收集计划为EgoLife A1_JAKE DAY1、DAY2各40条相邻完整30秒原片，目标每组20分钟。两组是同一参与者不同日期的真实生活，不是校园，也尚未核实跨房间重访与生活问答证据。保留鱼眼、原音轨和烧录时间/人物标识；模型未运行，右侧不生成地点判断或问答。

收集工具 `scripts/datasets/collect-long-real-videos.py` 固定revision `143fb319be7aa5ae210c936bf4f0f3a86092afb0`，每组上限1100MiB、3路并发、有限重试，核查原始LFS SHA-256和大小，并完整解码每条视频。根据源文件时间与实际帧数核对分片连续性，不用短片循环凑时长。下载、解码诊断和失败记录保留在各样本目录。

原始发布数据及只读manifest写入忽略目录 `datasets/long-real-videos-v1/`。只有全部40条完成下载、核验和完整解码，且相邻源时钟无缺口，才写manifest并进入列表。**目录存在、开始下载、HTTP成功均不代表已可回放**。具体完成以manifest和浏览器实测为准。

只读服务 `src/desktop/real-video-replay.ts` 提供列表、白名单元数据与带Range的MP4接口；不暴露源文件路径、QA或位姿。文件需位于归档根目录内，拒绝路径穿越；首次读取校验SHA-256，文件属性变化后重新核验。可用 `FIRST_SIGHT_REAL_VIDEO_ROOT` 指定可信本地归档根目录。录制与模型交互保持关闭。

复现：

```powershell
.venv/Scripts/python.exe scripts/datasets/collect-long-real-videos.py --output datasets/long-real-videos-v1
```

不接受覆盖已有目录。如中断，原失败保留，后续修复使用新目录或另行实现逐文件验证的续传；不能手动补manifest使不完整包看似完成。数据卡与代码许可分开，不代替用户签署需要注册/同意的数据集许可。

## 本轮实际完成

- DAY1与DAY2各40条原片，每条完整解码30秒：每组1200秒，合计2400秒（40分钟），80条原片全部完成大小和LFS SHA-256核验。源时钟相邻性检查通过。
- 318项TypeScript测试通过，包含Range、路径穿越、不完整包排除、原片改动拒绝与元数据隔离测试。
- `scripts/testing/check-long-real-replay.cjs` 在真实数据上验证两组原片加载、跨分片跳至15分钟、实际播放、30秒边界自动衔接；无浏览器异常/POST/接收会话/模型调用。截图及报告位于 `run/hardware/long-real-replay-ui/`。
- 已更新8884网页服务，两组列表、页面HTTP200及媒体Range HTTP206均实测通过。重启前记录与模型交互均关闭。仅更新网页服务，没有启动新硬件通信实验。
