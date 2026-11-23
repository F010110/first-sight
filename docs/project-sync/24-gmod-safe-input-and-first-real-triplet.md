# GMod无鼠标自动测试与首组三摄实测

2026-10-29。用户明确允许继续自动化，但要求解决鼠标固定中央、无法退出的问题。

## 安全模式

普通窗口启动、切出及ClipCursor解除不足以保证鼠标自由；先前多次启动造成5个残留进程，已按用户需求结束。此后不再使用普通重复启动或模拟键鼠。

`scripts/datasets/run-gmod-safe-smoke.py`包含：已有GMod则拒绝启动、命名互斥锁、800×600窗口、`cl_mouseenable 0`和`m_rawinput 0`、系统层禁用仅本次游戏窗口的输入、Windows Job进程树退出保护、45秒默认期限、20GB余量检查、游标区域限制检测、输出目录STOP文件退出。无前台激活、无输入注入、无新下载，不继承API凭据。

另加入Ctrl+Alt+F12紧急退出，无法注册则不启动。已实测可注册/注销，但**未在游戏运行中按键验收**。本轮两次真实捕获发生在热键补充之前，不倒推为热键实测。

Addon默认`fs_cursor_free=1`：官方`gui.EnableScreenClicker(true)`释放游标，InputMouseApply阻止物理鼠标改变视角。自动路线需脚本驱动，不依赖系统键鼠。启动参数可能被游戏保存；未来人工鼠标漫游需明确恢复`cl_mouseenable 1`和`fs_cursor_free 0`。

## 真实运行与修复

- v1：`run/gmod-safe-smoke-v1/`，真实静态三PNG，640×480、三个不同方向，无枪/HUD；总览`contact-sheet.jpg`。无注入事件、未检测到ClipCursor区域收窄、结束后无残留GMod。**但裸.jsonl后缀被游戏拒写，轨迹缺失，这轮不算完整通过。**
- 修复：运行时改为`trajectory.jsonl.txt`、`head_trajectory.jsonl.txt`并追加后验证文件大小；Python校验器兼容该后缀。旧文件保留。同时将被阻止的hideconsole/gameui_hide控制台命令换为官方`gui.HideGameUI()`。
- v2：`run/gmod-safe-smoke-v2/result.json`；真实episode位于游戏`garrysmod/data/first_sight/20261029_201203_162/`。3张原PNG、每路pose、轨迹均落盘。`image-validation.json`结构检查通过：图片解码/尺寸/不同hash、方向、外参、同frame/tick/time。结束后无残留GMod，无模型调用。

这些证据确认**静态三摄像素＋位姿最小闭环**，不证明动态动画/材质同状态、标定内参、真实米制尺度、60秒移动30组、物品持久化或最终生活地图。OS未检测到ClipCursor限制也不等于用户体验已认证，因此保留`runtime_cursor_freedom_certified=false`，等待用户反馈。

## 干净画面与后续

已部署本项目server/first_sight_life.lua：单人出生不发武器、禁止拾取武器/玩家伤害/飞行；client/first_sight_clean_view.lua隐藏生命/护甲/弹药/准星/武器模型和目标标签。三摄RenderView另禁HUD/viewmodel。导出图已确认无枪/HUD；原生主视图体验待用户确认。

自带gm_construct只验收传感器，不是正式生活样本场景。随后再找单张有家具、多层住宅、街道/商店且真实连通的现成地图，核查依赖/许可，不下载合集。

安全重试命令（无GMod实例时，每次新输出目录）：

```powershell
.venv/Scripts/python.exe scripts/datasets/run-gmod-safe-smoke.py --game-root 'D:/SteamLibrary/steamapps/common/GarrysMod' --output run/gmod-safe-smoke-next --seconds 45
```

测试期间Ctrl+Alt+F12或在输出目录建立STOP文件可终止；采集完成自动关闭测试窗口是预期行为，不能盲目重新启动。部署前核对已安装Addon hash，旧文件备份在`run/gmod-safe-deploy-v1/`和`v2/`。19项Python工具/数学/Lua mock/安全门测试通过，不等于19项引擎测试。
