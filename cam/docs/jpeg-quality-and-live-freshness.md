# JPEG压缩与实时输入抗抖动

## 结论及压缩方式

目前为相机传感器直接输出JPEG（实测sensor PID 0x26），不是主机先收原始RGB再编码，也不做JPEG二次有损压缩。对该ESP32-S3＋相机组合，这是已验证的低开销路径，不声称经过所有编码器搜索得到“最优”。WebP／AVIF可能降低文件体积，但需要额外编码资源及延迟；电脑收图后转码不能减少前面的无线传输。若转用连续视频编码，还需考虑关键帧依赖、断流恢复及保留原始独立图像的需求，不能直接替换当前输入协议。

相机JPEG参数数字越大越压缩，不能与Pillow quality百分比分数混淆。新固件通过USB启动时选择12或16，由sensor set_quality成功后响应X-Jpeg-Quality确认；主机请求不匹配会失败，不冒充已生效。保持640×480、三帧曝光更新、校验、长连接／分块策略不变。persistent模式开发默认16，可显式--jpeg-quality 12回退；旧非persistent固件仍默认12，不覆盖历史配置。

参数16的r2十二张原始JPEG上离线gzip实测合计仅减少约1.45%，还会增加压缩／解压和内存成本；当前不新增gzip层。未在设备上跑WebP／AVIF基准，不伪称它们一定更慢或已被排除。

## 两档各两轮，全部48张有效

顺序12→16→16→12，每轮新会话、12次计划、目标2秒，目录均为`run/hardware/portal-quality-20261022-...`。所有原图、request/receive时间及设备参数保留，0模型调用。

|后缀|有效／计划|平均字节|平均总耗时ms|最大／nearest-rank P95 ms|超过2秒|跳过时隙|
|---|---:|---:|---:|---:|---:|---:|
|r1-q12|12／12|11380.25|724.58|2923|1|1|
|r1-q16|12／12|17973.58|453.25|589|0|0|
|r2-q16|12／12|20720.67|965.67|4196|2|3|
|r2-q12|12／12|24789.25|1698.50|5933|4|5|

r1画面明显改变，不能拿它的平均字节作同场景压缩率。查看r2双方第6帧原图，风扇／箱体／灯具等布局相近、总体物体仍可辨；小字本来就较糊，不能据此认证文字辨识、视障提示或VLM空间无回退。r2的参数16平均体积少约16.4%，是近似场景对照而非同一无损原始帧的严格编码实验。不能把两轮的延迟差全归因于JPEG参数，校园链路仍有抖动。参数16目前仅开发默认，仍需真实任务细节与多场景验收。

## 已实现并接入的输入侧保护

新增`src/hardware/live-frame-policy.ts`，只管输入健康，不平滑地点身份：

- 独立采集进程归档所有完整图像，消费者读取已提交收据；待交付当前通道容量1，拥塞时保留最新待处理帧。被替换帧记superseded，原图不删除，可用于后续历史分析。
- 新鲜度以主机请求wall time计算，默认2500ms，包含传输与排队耗时；不是伪造精确曝光时间。超龄帧仅留归档，不进入当前通道；未来时间／回退时钟也不视为新鲜。
- 有效输入间隔大于2500ms，或中间有超龄／队列替换，continuity=unknown，不提供可直接建转移边的连续性依据。sample-continuous也只是输入采样连续，不证明空间连通。
- status超过新鲜度门限为current-state-unconfirmed；会话正常结束或异常停止也明确写该状态。状态文件附时间，读取方不能永久缓存fresh状态。
- 提供mayPublishCurrent(frame, now)异步完成复查：过期或已有更新帧时拒绝发布为当前结果。它已单测，**尚未接入模型输出提交过程**，不是已对历史SpatialContextLoop事务加了保护。

现有hardware runner新增显式`--live-policy`，仅允许`--validate-only --follow`。完整归档仍写accepted.jsonl，筛选过程写live-decisions.jsonl，健康写current-input-status.json。complete区分observations（全部通过完整性校验的归档）与deliveredObservations（当前通道实际交付）；stale／superseded不是无线丢图。该选项使用最新单帧当前通道，不冒充原CameraWindows全部窗口；不带选项的原历史／窗口处理行为不变。

例如：

```powershell
cam/.venv/Scripts/python.exe -X utf8 cam/portal_stream.py NEW-capture --count 12 --interval 2 --keep-alive --jpeg-quality 16 --confirm-http-credentials
# 另一终端，在plan.json生成后：
node dist/current/hardware/run-camera.js NEW-capture NEW-consumer --validate-only --follow --live-policy
```

## 实测与验证边界

q16两轮、r2-q12都在采集时并行跑消费者，路径为各capture加`-live-policy`。r1-q16交付12／12；r2-q16交付10／12、2条stale；r2-q12交付9／12、3条stale；原图均12／12保留。2秒超限与2500ms新鲜度判定不同，后者还含消费者排队，因此二者计数不应强行相等。

之后修紧continuity逻辑：被替换／stale明确打断连续性，默认gap与既有拓扑2500ms一致；这些通过确定性测试，不改旧实测日志。另对r2-q16已结束录像用当前策略回放到`...-stale-replay`，验证过去帧不能冒充实时输入。完整305项TS测试、Python图像校验测试通过，固件编译和应用区写入hash验证通过。

**尚未完成**：方法2实时推理、其Context／SQLite提交／UI“当前地点”对新鲜度门的接线，摄像头掉线自动重新认证恢复、长时压力测试、真实用户图像细节验收。为避免旧模型在调用过程中先写记忆再被事后丢弃，当前禁止`--live-policy --confirm-paid`，不把只加一个前置age检查当作完整解决。未修改运行中的冻结空间实验或自动调用VLM。

当前板上为支持启动选择JPEG参数的camera-portal-paced；最后实测参数12，重启后需主机再次配置，persistent脚本默认16。180秒服务上限仍在，结束radio off；未变成长期开机相机。
