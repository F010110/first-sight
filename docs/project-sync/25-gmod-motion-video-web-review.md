# GMod脚本步行三摄与原网页视频回放

2026-10-29。用户要求继续自动采集并将视频放回原有网页位置，自行检查。

## 已完成的实际采集

- 沿用安全启动器：只有一个实例、窗口输入禁用、无OS键鼠注入、Ctrl+Alt+F12/STOP/超时/低空间保护、Windows Job退出清理。运动模式启动总期限90秒，游戏内记录期限60仿真秒/65墙钟秒，128MiB数据上限。
- 客户端CreateMove程序生成正常前进和转向命令，4段步行和4次转向；没有位姿传送、noclip或重放旧片。每段12秒前进、3秒转向，碰撞由游戏执行。此脚本只用于空地图技术验证，不冒充随机生活行动。
- 实际结果`run/gmod-motion-capture-v1/result.json`：episode `D:/SteamLibrary/steamapps/common/GarrysMod/garrysmod/data/first_sight/20261029_202056_159/`，280组三摄、840张640×480 JPEG，约54.8MB；结束原因duration-limit。首末采样仿真跨度60.1505秒，采样约4.6组/秒（目标5Hz，实际间隔保留，未补造301组）。
- 所有图像解码、尺寸、非黑、独立视图、旋转矩阵、固定外参、同frame/tick/time检查通过：`validation.json`。抽查0/15/30/45秒原图见`contact-sheet.jpg`。真实位姿有运动并回到起点附近，按未校准0.0254单位约73.47m路径，不能当精确物理米制认证。
- 没有残留GMod进程、没有模型调用。未测有独立运动物体的三路严格同步，未标定内参/尺度，未选正式生活地图，未验收持久物品事件。

## 视频与原网页位置

生成器：`scripts/datasets/publish-gmod-review-video.py`。四份只读H264 MP4：三摄并排1920×512（含标签）、前/左/右各640×480。按真实相邻源时间设置画面保持时长，编码为10fps显示预览，无运动插值；末帧保持约0.215秒，成片60.3秒。**10fps不是原生采样10Hz，亦非实时游戏录屏。** 四个文件均经ffmpeg完整解码检查。

已发布到既有视频目录`run/spatial-preview-video/campus-episode6-first64s-v1/`，保留旧episode6及其hash，追加episode7–10。原目录清单备份在`run/gmod-motion-review-v1/catalog-before.json`，新工件hash/时长在`receipt.json`。未重启8884/8886或修改独立research。

- 原统一入口：<http://127.0.0.1:8884/>
- 直接检查并排视频：<http://127.0.0.1:8884/recordings.html?source=simulation&recording=campus-video:7>
- 同一“回放/模拟”下拉有GMod并排、前、左、右四项；旧样本不移除。单路可分别选择campus-video:8/9/10。
- 旧校园播放器的原样本选择器也读取同一目录，增加的显示标题尊重来源，不把GMod叫Tartan校园，不声称GMod原生10fps。
- 仅公开视频与范围说明，不通过网页暴露精确位姿或gold，也没有模型判断/问答。

服务原进程按请求读取视频清单及前端JS，所以无须重启。新四视频HTTP Range返回206，旧episode6仍存在。无真实录像分类混入模拟视频。

## 验证

`tests/web/test_gmod_recording_video.mjs`使用本机独立headless Chrome，无前台激活或游戏启动。实际打开8884原播放器：确认自动选中GMod、正确scope、视频时长60.3秒、可播放推进、拖动到25秒、切换三路视频均640×480，再返回并排。结果和截图：`run/gmod-motion-review-v1/browser/`。首次测试在DOM加载前求值失败，等待DOM就绪后复测通过，未掩盖游戏数据问题。

21项Python软件/数学/Lua mock/安全门测试通过；前端JS语法检查通过。C/D仍约96.33/76.53GB空闲，新增采集与视频衍生物约数百MB，未下载任何新地图或素材。

## 待用户检查

正常1×速度查看方向、转向、清晰度、视角覆盖和卡顿；当前只是gm_construct空地图。用户确认后再选择现成家具生活地图，不能用这次草地回环代替室内外生活验收。
