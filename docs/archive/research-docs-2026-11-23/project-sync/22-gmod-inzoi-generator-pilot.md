# Garry's Mod / inZOI：按用户调研报告启动验证

日期：2026-10-29。输入：`docs/notes/suggestions/调研报告.md`。本轮目标是三摄图像→位姿→模拟IMU→最小生活流程，不是立即完成最终长期数据集。

## 决策与实际状态

用户希望这成为最终方案；据此将**Garry's Mod优先原型、inZOI接口门槛验证**设为新主线。GTA/UnrealZoo历史工件保留，不继续扩下载；它们不与新主线争抢开发。最终技术验收仍未通过，不把偏好记成成功。

检查了已知Steam根目录及libraryfolders声明的两个库、对应App4000/2456740清单，并查询相关卸载注册表，未找到安装。**这不是检查了全部磁盘，也不是证明用户没有购买**。当前没有可运行的游戏构建、版本、地图或Mod环境，因此本轮没有启动这两个游戏、没有实际三摄样张。

审计脚本：`scripts/datasets/audit-game-generator-environment.py`；收据：`run/game-generator-selection-v2/audit.json`。11份官方文档已保存hash。v1的Facepunch页面因1MB限制失败；其页面包含大量导航，明确提高到5MB/源后v2全部取回，实际各约1.47MB，没有无界下载。当前C约95.45GB、D约84.18GB空闲（实时会变化）。

## Garry's Mod：原型交付

**文档确认**：RenderView指定视角渲染到当前目标；Push/Pop保存恢复目标和viewport；Capture返回PNG/JPEG字节。官方提示RenderView静态prop/LOD距离问题、渲染回调外黑图、PNG alpha问题和菜单打开返回nil。

**已实现但尚未引擎实测**：`integrations/gmod/first_sight_capture/lua/autorun/client/first_sight_capture.lua`。单人Sandbox客户端Addon，PostRender同回调三次RenderView/Capture，不修改人物视角；保存640×480三PNG、FLU旋转矩阵、独立相机位姿、每路前后frame/tick/sim/wall时间和图像CRC。采用1024²复用纹理、640×480显式viewport，不假定非二次幂纹理可用。Source左右yaw符号与UE相反，left=+90/right=-90，后续实际视觉确认。

默认不录制，命令触发静态1组或动态30组、间隔2仿真秒；65秒墙钟/128MiB单episode/2MiB单图上限。nil、异常、仿真时间推进会停止，异常路径恢复目标栈，递归回调有保护。每图写后检查大小，整组完成后提交轨迹。Think轨迹与图像分离，没有插值冒充高频IMU。无伪造同步标记，same-state验收始终未通过。

辅助：

- `scripts/datasets/install-gmod-capture-addon.py`：验证真实游戏目录、20GB空闲，仅在显式confirm-copy后复制；不覆盖已有Addon，不启动/购买/安装游戏。
- `scripts/datasets/validate-gmod-capture.py`：解码PNG、尺寸/黑图/重复视图、路径、时间与外参检查；输出SHA256，但不自动认证同步/生活能力。
- `scripts/datasets/gmod-trajectory-to-imu.py`：从实际密集头部矩阵序列差分得到FLU比力/角速度及独立含白噪声测量。大缺口、重复时间或坏旋转拒绝，无重采样。单位尺度未校准，不声称物理真实IMU；偏置漂移等后续再加。

运行说明：`integrations/gmod/README.md`。物品事件ID、持久化、正式Agent输入投影、城市地图及实际走楼梯/跨建筑尚未实现；不将空白Sandbox当生活世界。

## inZOI：比报告新增的证据与未解门槛

官方目前公开Public/B1Standalone/Experimental CLI：`camera.get_view`、`screenshot.capture`、`screenshot.get_last`。主相机位姿与引擎自身截图存在文档接口，**不能再说完全没有截图入口**。但capture异步在后续呈现帧写盘，返回路径不等于文件已存在，也不代表pose绑定；且没有从所查camera目录确认任意设置朝向的接口。

`AB1SceneCapture2D`的CaptureScene/OnCaptureScene仍仅证明B1内部类和材质回调存在；普通B2 Lua能否创建和读回RGB仍未知。没有凭UE通用能力生成伪三摄代码。

已交付`integrations/inzoi/probe-capabilities.mjs`及README：需要真实UI Mod宿主CLI，默认只读相机，显式capture时最多发一次截图与一次状态查询，原样保留API错误/envelope，不自动标保存成功。**这不是已部署UI Mod，更不是可独立运行的采集器。** 游戏和真实宿主缺失前不能给出三摄可运行承诺。

## 本地测试（全部是工具/模拟接口测试）

14项Python：库清单发现、显式安装/拒绝覆盖保护、图像路径安全、静态文件校验、黑图/时间推进拒绝、静止/直行/转向/垂直加速IMU数学、噪声复现，以及5项Lua mock执行测试（静态/30组停机、无自动录制、单人限制、异常清栈、递归防护、超时）。另有3项Node CLI mock测试。**17项通过不等于17项游戏能力通过**；夹具仅在临时测试目录，不能当研究样本。日志保存在`run/game-generator-selection-v2/python-tests.log`和`node-tests.log`。

Lua执行使用隔离工具目录中的`lupa==2.6`（约1.7MB wheel），未加入项目依赖或安装游戏。未修改独立research/，未动8884，未调用模型。

## 安装与授权边界

Steam页面当日列Garry's Mod最低10GB/推荐25GB，inZOI最低40GB/推荐60GB，均不是保证当前下载字节数。地图、依赖资产、Shader缓存与ModKit另计。优先只安装一个，至少保留20GB余量；本轮未下载游戏、地图或大型引擎。购买/登录由用户完成，不读取账号凭据。Workshop资源可订阅不等于科研数据可再分发；两款游戏及各地图/资产许可均待核实，不宣称授权已解决。

## 下一步严格验收

1. 用户提供已安装游戏位置，或先在Steam持有并安装Garry's Mod。复制Addon后先静态1组三图，人工查看原图及日志。
2. 修复实际渲染问题，再正常移动60秒取得至少30组，验证动态图同步、LOD、方向、渲染恢复和记录间隔；缺帧真实报告，不补造。
3. 用真实Think轨迹核实坐标尺度、相机投影、频率，再测试静止/直行/转弯/上下楼IMU；软件数学夹具不替代这些运行测试。
4. 前两核心环节通过后选定许可适用的现成生活地图，完成二楼→另一栋建筑→移动物品→离开重访及重载恢复，不以传送/背包菜单代替视觉状态。
5. inZOI安装后先部署官方UI宿主探针；若仅能主视图截图，继续限定其能力，不通过桌面截图宣称完成三摄。遇闭源/权限门槛按报告止损。
