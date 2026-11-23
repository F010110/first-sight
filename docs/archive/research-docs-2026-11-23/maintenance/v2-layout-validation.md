# V2目录整理与验证

基于673a9e4，按v1.2.0的功能分包方式整理真实文件。版本仍为2.0.0；既有v2.0.0标签保留第一阶段保存点，整理提交不重写旧标签。

## 实际迁移

- scripts顶层只留导航，28个原散落脚本归入testing、maintenance、media、datasets、spatial、review、evaluation、network。
- cam/host集中19个电脑侧工具及相邻测试，cam/build保存构建钩子；cam/src专属固件。
- desktop保留HTTP、展示与视频应用，7个实验／评分入口移入src/sim/evaluation。
- 共55条源文件迁移，逐项见[v2-layout-map.json](v2-layout-map.json)，没有旧路径wrapper。
- 同步修正导入、当前构建入口、Python子进程、PlatformIO钩子、npm命令和文档链接。
- 私有配置仍在cam/local，录像及数据库仍在run，冻结dist不动；原有未提交TODO、未跟踪诊断文档与需求PDF不纳入提交。

## 验证

|检查|结果|
|---|---|
|npm test：当前构建＋TS全套|314/314通过|
|cam/host相机本地回归|14/14通过|
|新增布局回归|4项：迁移目标／无wrapper、顶层约束、Python语法、npm入口|
|完整根Python回归|165/165通过（含新增4项布局回归）|
|JS工具node --check|18个通过，仅语法检查，不执行工具|
|Chromium mock API|系统／记录开关及三种桌面尺寸通过；0脚本错误、0模型调用|
|camera-network固件构建|成功，未刷写／复位|
|真实服务|按新路径启动，实时／回放API可用；running=true，paid=false，recording=false，recordedFrames=0，inputError=null|

完整Python回归发现并修正：标定测试仍导入cam.calibrate；历史HTTP烟测仍启动旧dist而非dist/current；冻结V1测试错误地拿V1版本／hash比对演进中的V2。现在核验v1.2.0原tag的版本及全部原hash，不修改旧manifest、不放宽hash断言。HTTP测试保留启动错误信息，并使空闲端口探测与服务的wildcard绑定一致，避免Windows全套测试后的地址占用冲突。

未重跑付费评测、移动路线或热点／中继实验。源码整理通过不代表网络可靠性验收；核心业务拆分、长期资源与重启恢复仍是独立工程任务，不能包装成已完成。

新增脚本必须选择功能包；desktop不再接受评分／实验入口。改路径须核验导入、subprocess及文档；冻结manifest和运行回执不为目录整理重写。
