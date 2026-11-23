# First-Sight Garry's Mod 三摄试验

**最新状态：真实静态三摄PNG＋位姿＋轨迹已导出，结构检查通过；动态同步、移动及生活地图尚未验收。** 安全启动与证据见`docs/project-sync/24-gmod-safe-input-and-first-real-triplet.md`。下方手动操作不作为当前自动化启动方式；自动测试必须使用安全启动器，不能模拟按键切窗或多开游戏。运行时JSONL文件使用`.jsonl.txt`后缀以符合GMod写入限制。

购买安装阶段先看[安装后第一轮清单](INSTALL-FIRST.md)，可用离线`prepare-gmod-pilot.py`自动发现Steam安装并预检，避免手填默认路径。

本机已检查Steam库中未找到App4000。需要用户持有正版并安装游戏，不能用Lua单测代替运行。无需先装Mod工具链、大型城市地图或独立引擎。第一轮自带地图只验收传感器，**不是最终生活场景**。

## 安装与运行

1. 在Steam安装Garry's Mod；用Steam“浏览本地文件”取得安装根目录。安装前保留至少20GB空闲，Workshop和依赖额外占空间。不要一次订阅地图合集。
2. 从本仓库执行（路径替换为实际安装根目录）：

   ```powershell
   .venv/Scripts/python.exe scripts/datasets/install-gmod-capture-addon.py --game-root 'D:/SteamLibrary/steamapps/common/GarrysMod'
   .venv/Scripts/python.exe scripts/datasets/install-gmod-capture-addon.py --game-root 'D:/SteamLibrary/steamapps/common/GarrysMod' --confirm-copy
   ```

   第一条仅预检，第二条复制原型；已存在的Addon拒绝覆盖。源文件在`first_sight_capture/lua/autorun/client/first_sight_capture.lua`。不修改游戏二进制。
3. 启动游戏，创建本地**单人Sandbox**，先用自带地图。键鼠原生控制人物，不使用noclip完成正式路线。启用开发者控制台，运行：

   ```text
   fs_capture_static
   ```

   返回游戏画面；控制台/菜单影响渲染时先关闭它们。该命令采1组静态三摄。
4. 静态图通过人工检查后，再运行`fs_capture_start`，关闭控制台并正常走动/转向约60秒。默认每2仿真秒采一次，最多30组；`fs_capture_stop`手动停止。运行65秒墙钟时间上限由Think检查；游戏完全挂起时检查也会停，但不会继续写图。
5. 输出在游戏的`garrysmod/data/first_sight/<episode>/`。按游戏实际输出文件名检查，不假定采集已成功。每组有三PNG、独立pose JSON；`trajectory.jsonl`只提交三图均写入后的样本。

## 预检与验收

```powershell
.venv/Scripts/python.exe scripts/datasets/validate-gmod-capture.py '<实际episode目录>' --minimum 1 --output run/gmod-static-review.json
.venv/Scripts/python.exe scripts/datasets/validate-gmod-capture.py '<实际动态episode目录>' --output run/gmod-dynamic-review.json
.venv/Scripts/python.exe scripts/datasets/gmod-trajectory-to-imu.py '<实际episode目录>/head_trajectory.jsonl' --output run/gmod-imu.csv --accel-noise 0.02 --gyro-noise 0.001
```

输出文件拒绝覆盖。图像校验用Pillow、位姿/IMU用NumPy（本项目venv已有）。结构检查涵盖PNG解码/尺寸/黑图/重复视图、路径安全、时间间隔、旋转矩阵、固定外参与方向。但**结构通过不代表同步通过**，`synchronization_verified`始终保持false，直到另有实际动态对照验收。

还要实际检查：左右标签、图像翻转/透明、主视图恢复、远景/静态prop/LOD、动态对象三路一致性、行走是否受阻。首轮应让一个动态物体在重叠视野中运动，检查同一采样的对象状态；同FrameNumber/TickCount/CurTime只能证明边界一致，不能证明材质/粒子/动画没有逐视图副作用。

## 坐标与传感器边界

- HeadPose采用玩家`EyePos/EyeAngles`，不是解剖头骨，也未验证等同主渲染相机。头动/视角抖动的代表性待测。
- 输出旋转矩阵是`world_from_FLU`，列为Forward、Left、Up，右手系；Source yaw +90是左转，所以代码left=+90/right=-90。这不同于报告的UE式yaw符号，不盲套数值。
- 三摄默认同光心；偏移/偏航在Lua的`cameras`表可配置，偏移采用Source单位的局部FLU坐标。FOV可用`fs_capture_fov`配置（启动采集时冻结），目前只支持640×480，不能宣布其他分辨率已测。
- 默认单位换算0.0254m/Source单位，只是约定，**未校准**；可配置`fs_capture_m_per_unit`。RenderView FOV实际投影与内参也未校准，暂不伪造K矩阵。
- `head_trajectory.jsonl`在客户端Think中采样，受帧率约束，跳过重复仿真时刻；不是引擎原生高频IMU。CSV由真实轨迹差分得到近似加速度计比力/陀螺，保留理想值与加白噪声测量。缺口>0.25秒/逆序会拒绝，不插值冒充高频；尚未实现偏置随机游走/磁力计。
- 位姿、相机、地图信息均为生成/评分侧真值，不能把整个目录直接喂在线Agent。正式输入投影与world_events/持久物品ID尚待实现。

## 存储与隐私

加载Addon不会录制，只在明确命令后录制。本版最多30组、每图2MiB、每episode累计128MiB（含轨迹，另留小型结束收据）；遇到捕获异常就停。无网络请求、无模型调用、不捕获桌面。多个episode的总占用需在运行前检查；Lua未提供本原型可验证的系统剩余空间接口，**不是整盘容量守护程序**。

## 生活地图与许可

传感器通过后再选一张现成现代住宅/街区图，验证二楼→楼梯→街道→另一建筑→移动物品→离开重访及保存重载。地图、依赖游戏（如CSS）、模型许可分别核查；不自动下载缺失纹理包，不将Workshop可订阅当数据可再分发授权。Garry's Mod可录制不等于全部资产可公开打包。
