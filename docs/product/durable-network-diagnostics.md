# 持久化网络诊断：桌边故障注入

当前固件独立NVS namespace net-history，固定48条事件，保留Wi-Fi关联/断开/IP事件、所有失败上传、失败后的首次成功，以及约30秒一次成功心跳。每条带原始bootId、uptime、sequence、错误码、整次取图上传耗时、RSSI/channel/BSSID。每次有事件即提交NVS；写入失败通过writeFailed暴露，不自动清除历史。错误高频发生会增加Flash磨损，本功能为短期调试，不是无限耐久生产日志。

覆盖规则为最近48条，total超过capacity即有旧事件被覆盖。恢复成功后立即、正常每30秒经鉴权POST回传整份历史，电脑追加保存且回复200；暂不按确认清除，避免误删，快照有重复。长时间无网且持续失败仍可能覆盖早期历史；不能承诺一次路线所有原因全知。没有实现录制图像离线缓存／断网补图，不能声称解决了无线丢图。

USB兜底：`cam/read_network_history_usb.py --reset`，无需校园网；输出仅诊断元数据，不输出凭据。鉴权GET /v1/network-history也可读。摄像头无网络时仍先处理USB命令，但Portal/上传阻塞会延迟响应。USB脚本明确复位用于验证，不推断任意串口打开不会重启。

实机：首次实现局部128事件数组导致loopTask栈溢出重启，已改静态缓冲并重新编译烧写Hash验证。保留此失败事实，不将其算用户路线故障。

故意停止电脑接收器制造连接失败：boot 556edf5a625e2c01，序号0/1错误-1，耗时3304/3303ms，RSSI-55。USB快照run/network-diagnostics/usb-1792765838295748400.json。再明确复位后快照usb-1792765848923660900.json仍包含同一boot相同两条错误，writeFailed=false，证明已提交历史跨复位保留。未声称助手完成物理拔电测试，正在NVS提交中的瞬间失电可能丢最近一条。

错误码-1001=取帧失败，-1002=HTTP begin失败；其余负码来自HTTPClient（-1连接失败，不足以单独判断AP或防火墙）；正码为HTTP响应。Wi-Fi disconnect kind的code是SDK reason，不能混淆。

接收服务autoReceive已改监听时立即启动，不等网页打开；默认仍无模型调用／无图像落盘。诊断记录在capture/network-diagnostics.jsonl，接收端失败元数据在network-errors.jsonl。Python回归包含默认预览诊断保存但0JPEG；TS build及6项实时测试通过。

恢复电脑接收后，实机自动归档run/realtime-system/b56831ec-0d49-41bb-aef9-9a9c72198b7f/capture/network-diagnostics.jsonl，总计11条，包含上一个boot序号0/1/2和新boot序号0的-1错误，确认跨复位历史不靠手动读取也成功回传；接收状态receiving，记录与模型均关闭。故障注入闭环通过，但不等于校园漫游已修复。
