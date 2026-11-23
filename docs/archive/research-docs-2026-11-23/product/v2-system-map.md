# V2系统边界：硬件—软件、前端—后端

V2是当前单摄校园网生活助手原型，不是未来随身工业计算机版本。主采集／接收基线53afa22，另保留记录开关与回放分段。断网、误判、安全与未验收边界见[发布说明](../releases/v2.0.0.md)。

## 真实运行链路

```text
ESP32-S3 + 相机（固件，单前视图）
  cam/src/main.cpp                 初始化、网络模式方向校正
  cam/src/network_camera.h        校园认证、取图、JPEG16、boot/序号/hash、POST
                │ 校园Wi-Fi / HTTP bearer鉴权
                ▼
电脑：Python接收进程（8885，绑定指定校园IPv4）
  cam/host/push_stream.py              认证、长度/hash/尺寸/序号校验
    ├─ stdout预览JPEG ───────────→ 最新帧RAM（默认，不保存图像）
    └─ 记录有效时：JPEG + observations.jsonl
                │ stdin接收record:true/false
                ▼
电脑：Node实时服务（8884，仅127.0.0.1）
  src/desktop/realtime-server.ts   控制API、静态资源、证据读取
  src/hardware/realtime-session.ts 编排接收、记录、模型、问题及生命周期
    ├─ camera-input.ts            收据及归档路径校验
    ├─ prepare_live_image.py      原图校验、像素等价PNG与视觉特征
    ├─ live-frame-policy.ts       最新帧、2500ms新鲜度、gap保护
    ├─ realtime-method2.ts        空间生产者：recent2/visual2、recent6访问
    │    └─ src/agent/*           共享推理协议、VLM接口、完整成员原图比较
    ├─ realtime-memory.ts        SQLite：原图、判断、问题、因果快照
    └─ realtime-question.ts      独立只读问题Agent：search→inspect→answer
                │ 同源HTTP / JSON / 图像
                ▼
浏览器（不直接接摄像头，不持有模型或设备密钥）
  web/desktop/realtime.*          预览、记录、系统开关、空间摘要、问答
  web/desktop/recordings.*        只读录像回放、时间轴、倍速、原图证据
    └─ src/desktop/live-recordings.ts：读取SQLite及开关事件、限制证据路径
```

## 各层能做什么、不能做什么

|层|负责|不负责|
|---|---|---|
|固件|采集、认证、主动上传、boot与序号|不运行VLM；无离线图像补传；非三摄同步控制器|
|Python接收|输入验证、RAM预览、按记录控制存图|不启动模型；不做空间身份判断|
|Node编排|模式、模型预算、因果记忆、前端API|不把丢图补造成观察；不保证网络可达|
|空间Agent|选候选、比较真实原图、固定范围、unknown|候选不等于身份；不靠时间邻近断言物理距离|
|问题Agent|读取提问时快照、检索并实际查看原图|不能修改空间分组；不能读取未来判断|
|实时前端|操作状态、显示来源与新鲜度|不直接运行付费推理、不把最后一张图当当前保证|
|回放|重放已有记录／已产生判断／问题|不新增VLM调用、不重算空间分组|

方法2仍使用访问序列／证据拓扑辅助；代码中`SpatialVisitTopology`不等于重新启用已放弃的guarded-graph路线。真实单摄就是缺左右视图，不复制前视图冒充三摄。

## 三种模式

- **默认预览**：最新JPEG在RAM；无图像归档、无VLM调用，非图像元数据可写。
- **手动记录**：保存JPEG、像素等价PNG和SQLite观察，不调用VLM。
- **系统启动**：有效记录=`manualRecording || paid`，空间分析持续运行，提交问题才触发问题Agent；关闭系统恢复手动偏好。

回放依据记录有效状态开启／关闭事件分段；断联、boot变化、断电不拆段。系统自动包含记录的语义仍保留，系统开启期间不能关记录。分段为虚拟视图，不搬原图；隐藏旧列表只是可见性过滤，不删除证据。

## API与进程边界

|端口／通道|调用者|内容|
|---|---|---|
|设备80（兼容）|旧pull接收端|鉴权状态／图像，当前push无需轮询|
|电脑校园IP:8885|摄像头|仅POST /v1/upload，bearer配对密钥|
|127.0.0.1:8884|本机浏览器|实时／记录／系统／问答／回放；Host与Origin检查|
|Python stdout / stdin|Node↔子进程|预览JSON；记录开关控制|
|模型服务|Node provider|环境变量中的Qwen凭据，不传给浏览器／摄像头|

主要控制路由为`/api/live/state`、`/recording`、`/start`、`/stop`、`/question`；回放为`/api/live/recordings`、`/recording`（GET）、`/recorded-image`。同路径不同HTTP方法不混为一类调用。

## 历史链路不能混用

`src/assistant/`和`src/desktop/server.ts`属于视频生活助手与旧入口；`src/sim/`、`sim/`供离线评测、审核、研究，桌面评分／实验已移至`src/sim/evaluation/`；`web/`根页面属于历史手机工具。它们与当前实时链路共享部分Agent代码，但不等于已合并成一个运行时。Android中继已放弃，构建APK与日志仅为本地历史产物。

**结论：工具与应用／评测入口已按层归位，核心业务代码还不是完全解耦的分层架构。** 尤其`src/hardware/`同时包含适配、业务编排、存储、空间与问答，`src/agent/`混有现用与历史算法。后续拆分清单见[仓库审查](../maintenance/v2-repository-audit.md)；本次不把目录整理扩大成业务架构重写。
