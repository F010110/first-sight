# TypeScript源码导航（V2）

当前真实单摄入口是`desktop/realtime-server.ts`，不是本目录所有server／agent文件都会随它启动。[完整系统图](../docs/product/v2-system-map.md)。

|路径|当前职责／身份|
|---|---|
|`desktop/realtime-server.ts`|8884本机控制与页面入口|
|`desktop/live-recordings.ts`|SQLite／事件日志只读回放、分段、证据路径校验|
|`hardware/realtime-session.ts`|实时主编排，调用Python接收和模型／存储|
|`hardware/camera-input.ts`、`live-frame-policy.ts`|设备收据、真实视图、新鲜度与缺口保护|
|`hardware/realtime-method2.ts`|当前空间生产者，调用共享agent协议|
|`hardware/realtime-question.ts`|独立只读问题Agent|
|`hardware/realtime-memory.ts`、`live-provider.ts`|当前SQLite与模型预算／请求适配|
|`agent/`|现用共享协议＋多代空间实验；不是单一已发布算法集合|
|`assistant/`、`desktop/server.ts`|旧视频生活助手应用链路，独立于实时主编排|
|`sim/`、`desktop/experiment-*`及评分入口|离线评测／开发／历史实验，非默认实时服务|
|根目录旧trial／motion等入口|历史手机采集、轨迹与工具，见各文档复现|

邻接的`.test.ts`由`scripts/test-typescript.mjs`按源码清单运行，避免命中旧dist中的残留测试。构建到`dist/current`，不能覆盖历史冻结目录。物理目录尚有业务／适配耦合，本轮只补导航，不搬迁路径或修改评测。
