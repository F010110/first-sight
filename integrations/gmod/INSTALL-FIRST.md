# 购买安装后，第一轮怎么做

## 你现在需要做的

1. 在Steam购买并安装 **Garry's Mod（App4000）本体**。不用先买其他Source游戏，不需要单独安装引擎或ModKit。
2. 可以优先选D盘Steam库；安装器显示的实际空间需求优先，安装后至少保留20GB空闲。
3. 暂不订阅Workshop地图合集、不连接公共服务器，避免自动拉取大量依赖。某些地图需要CSS等游戏资源，后续选图时再单独核查，不下载来路不明的纹理补丁。
4. 安装完成告诉助手即可；若不在Steam默认/已声明库，提供Steam“管理→浏览本地文件”的安装根目录。不要提供账号密码。

## 助手安装后执行

从项目根目录运行，只读预检（无联网、无游戏启动）：

```powershell
.venv/Scripts/python.exe scripts/datasets/prepare-gmod-pilot.py --output run/gmod-readiness-installed-v1.json
```

确认正确游戏目录、至少20GB余量后，再显式复制Addon：

```powershell
.venv/Scripts/python.exe scripts/datasets/prepare-gmod-pilot.py --confirm-copy --output run/gmod-readiness-copy-v1.json
```

需要自定义路径时加`--game-root '实际GarrysMod根目录'`。相同版本的已安装Addon只核对hash，不重复复制；不同版本/陌生文件保留并停止，不能直接覆盖。

## 首次游戏内验收

1. 从Steam正常启动，选择“开始新游戏”，自带地图（如列表中可用的`gm_construct`），Sandbox、单人。此地图只验证相机，不作为最终生活数据集。
2. 在键盘设置的高级选项启用开发者控制台，通常用`~`打开。控制台运行`fs_capture_static`，然后关闭控制台回到画面；不修改Steam启动项或系统安全设置。
3. 检查输出的3张原图及pose，确认左右方向、非黑图、尺寸、透明和LOD；**先检查再录60秒**。
4. 通过后运行`fs_capture_start`并返回游戏，WASD移动、鼠标转向。正式行走不用noclip。采集最多30组三摄，65秒墙钟截止，或`fs_capture_stop`提前停止。
5. 数据在游戏`garrysmod/data/first_sight/<episode>/`；本轮最多128MiB/episode。不要在未检查上一轮结果时连续开启大量episode。

异常就停止并保存原始日志/文件，不卸载游戏、不清缓存、不重复下载安装碰运气。三路同frame/tick不是同步最终认证；仍需检查动态对象、动画和渲染副作用。

完整校验及IMU命令见[README](README.md)。首轮成功后再挑一张完整现成生活地图，逐步测室内外、楼梯、拿放、重访和保存重载。
