# 前端导航（V2）

|文件|入口／身份|
|---|---|
|`desktop/realtime.html/js/css`|当前实时主页面，8884/realtime.html；RAM预览、记录switch、系统开关与问答|
|`desktop/recordings.html/js/css`|当前真实录像回放，8884/recordings.html；只读，不新调用模型|
|`desktop/camera-orientation.css`|当前不旋转，180°校正在网络固件；不要再加网页旋转|
|`desktop/index.html`、`app.js`、`view-model.js`、`comparison-view.js`、`recording.js`|视频助手／比较与历史UI，共用desktop目录但不等于V2实时应用|
|根目录其他页面|旧手机HTTPS／采集／审核工具，不作为当前设备中继|

浏览器通过本机8884 API读状态、操作记录／系统／问题，不直接与摄像头8885通信，也不持有设备配对密钥或模型密钥。回放API在`src/desktop/live-recordings.ts`，开关事件决定片段边界，boot／断联不拆段。

HTML/CSS/JS为直接静态服务，无额外前端编译；修改后刷新。TS API更改则需构建与重启。当前JSON字段仍手工维护，没有共享生成契约；[待整理清单](../docs/maintenance/v2-repository-audit.md)。
