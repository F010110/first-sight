# Portal单摄Wi-Fi传图与现有输入流程

新增独立`camera-portal`固件：沿用640×480／JPEG质量12、抓拍前丢弃三帧等待曝光更新。共享`portal_session.h`保留原诊断入口；不改变原camera串口／camera-wifi三摄协议。账号经USB临时提供，明确HTTP授权，仅对已核实端点一次登录。随后USB传随机64位hex token，板端开放需Bearer的单帧GET `/v1/frame`，最多180秒后自动关闭服务和radio。未改电脑防火墙。HTTP token／SHA256不提供加密或防中间人保护，不能用于公网。

主机`cam/host/portal_stream.py`只经Wi-Fi拉JPEG，USB用于供电和初始配置，图片不走串口。禁用代理，限制私网地址／JPEG长度，核对原图解码、640×480、wire SHA256、连续设备序号及boot不变，保存原图与收据；异常停止，不自动跨设备重启续接。单摄明确front，左右缺失，不复制三视图；设备时间仅原始值，不当作主机对齐曝光时刻。

2026-10-22第一次实测目录`run/hardware/portal-single-20261022-v1`：30张原图全部收到并校验，但目标2秒采样**未达标**。平均请求间隔3103.45ms，平均请求至完整接收2200.2ms、最大4636ms，跳过18个计划时隙；不是丢掉已归档帧，也不是稳定0.5fps。校园网电脑可达板上HTTP，不需要开电脑入站端口。

这30张经`src/hardware/run-camera.ts --validate-only`接入现有cameraObservation＋CameraWindows，结果保存在`run/hardware/portal-single-20261022-v1-validated`。新增wifi-single-http收据保留单视图并验证wire／device元数据；旧serial及三摄wifi-http继续保留。该验证不调用VLM，也不创建Context／SQLite推理输出；不能称为方法2在线识别或完整实时问答集成。尚未改桌面“真实”入口。已有硬件runner付费路径使用历史SpatialContextLoop，不等同于已固定的独立方法2，后续需单独接通并明确预算。

硬件输入／runner六项TS测试、Python wire/reset/sequence验证测试通过，固件编译和应用写入hash验证通过。原图、日志、账户与设备token不提交Git。当前180秒有界验证不是长时认证保持、三摄同步、延迟保证或安全上线验收。

## 第二轮：关闭板端Wi-Fi省电及实时follow

仅在camera-portal增加WiFi.setSleep(false)，未降低分辨率／JPEG质量或减少曝光更新等待。目录`run/hardware/portal-single-20261022-v2-nosleep`，30/30张有效；平均请求间隔3034.48ms，平均请求到接收1584.77ms，最大4793ms，跳15个采样时隙，仍不满足稳定2秒。两轮画面内容／压缩字节数和校园无线状态不同，单次结果不能证明省电是根因；v2后半段较快也不能替代整轮指标。

本轮生产者后台采集时并行运行：

```powershell
node dist/current/hardware/run-camera.js run/hardware/portal-single-20261022-v2-nosleep run/hardware/portal-single-20261022-v2-nosleep-live-validated --validate-only --follow
```

实时消费者完成30观察、8窗口，状态validated-no-model，无缺失采集轮；accepted.jsonl保留完整单摄原图收据，results.jsonl保留窗口。这里missingCaptureRounds=0表示没有丢弃已请求的有效帧，不抵消生产者missedScheduleSlots=15（因请求过慢跳过的计划时隙）。没有运行SpatialContextLoop模型或付费空间方法2，没有推理SQLite，也未启用网页真实入口。USB仍需供电及启动时传临时凭据/token，断开USB后独立供电及无主机认证未验证。

当前服务仅本次启动后180秒，过期自动停机；再次运行主机入口会复位并重新初始化会话，不保证不经确认重复登录。HTTP凭据风险已获用户确认，图片与token也仍明文传输；不得将此临时服务长期暴露校园网。后续性能诊断应记录连接／首字节／抓拍／传输阶段耗时，比较固定画面或重复场景；不能仅凭总耗时断言都是无线传输延迟。
