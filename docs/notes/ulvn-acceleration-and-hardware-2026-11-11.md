# ULVN加速机制与4090判断：源码核对和分段计时

本机nvidia-smi确认RTX4060 Laptop GPU 8GB，驱动566.26；隔离环境PyTorch2.6.0+cu124。不能将本机结果叫桌面4060/4090成绩。

## 官方机制

- 已固定ULVN e2f47fe源码：RAVEL为建图路径，FAISS range_search按VPR距离先筛，再调用LightGlue；BPL/BASS是预建地图上的概率定位/规划，不要求每40秒输入把20×20×9图对重跑。本地在线增量适配的工作量不是官方在线定位的必需开销。
- LightGlue官方README（https://github.com/cvg/LightGlue）提供FlashAttention、自适应深度/点剪枝、torch.compile(reduce-overhead)、混合精度mp=True；减少层数/调适应阈值会影响匹配，需回归。ONNX/TensorRT为第三方导出方向，不能称本项目已支持。
- 本地默认flash=True、depth_confidence=.95、width_confidence=.99、9层，mp=False；torch flash SDP开关True不证明每次所有核函数实际用了最佳Flash内核。未启用compile，未测试混合精度。不能宣称所有官方加速已用尽。
- 官方README宣称RTX3080在编译/自适应配置下1024点约150图对/s，这是匹配网络基准，不包括我们的读图、特征、CPU RANSAC、调度或三摄地点判定，不能替代40秒实测。既有官方RAVEL阈值在本数据曾标定退化，不能为提速直接照搬筛选阈值。

## 新的同步分段计时

`run/ulvn-pair-phase-profile-v1/report.json`：4个固定图对各3次，无付费、不改任何算法参数；GPU阶段torch.cuda.synchronize。一次报告序列化失败记录保留，修正序列化后按同样4对重做，不择优选对。不是完整数据性能分布。

排除每对首次局部特征抽取后：

- LightGlue约37–51ms/图对；实际早停7–8层，非每次全部9层。
- CPU cv2.findFundamentalMat(FM_RANSAC)约14–37ms/图对。
- 缓存特征准备约1ms，下载匹配/坐标约0.3–0.4ms；第一次局部特征抽取约59–208ms。

因此之前将148秒整个几何阶段主要说成GPU注意力计算是不够精确的：GPU匹配重，CPU几何核验也有实质开销。512点无法按注意力理论平方比缩短端到端核验，也与仍存在CPU/固定开销一致，但没有完整profile不能量化各项全窗占比。

## 4090可否实时

151秒→40秒需要整个窗口至少约3.8倍加速。4090可能明显加速GPU部分，但CPU RANSAC、Python调度与逐对同步不能按GPU算力同比缩短。若保持当前密集逐对协议，不能承诺4090达标，也不建议先买卡或上云赌解决。

官方3080核函数成绩表明算法还有实现加速空间，不是所有视觉重访都必然要151秒。应先验证编译/混合精度与CPU几何开销/候选调度，再用目标设备实测。若最终需要远端，可用自有桌面GPU并非必须公有云；网络/部署另有约束。此次仅硬件和源码核对/4对免费profile，未启动813、未恢复付费系统或安装新后端。
