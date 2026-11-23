# UnionCity Day下载与首次加载

2026-10-29，用户批准单地图有界验证后实际执行。

- 官方DownloadUGC成功：Workshop1681190843，785649987字节；未订阅合集或下载依赖。
- GMA SHA256：`a396df8c77d9744bb1ef1d779033c4e43e608ca021ca0d44538016d21e7052d2`。
- 只读索引检查：仅`maps/rp_unioncity_day.bsp`和缩略图，没有Lua/二进制。BSP20内嵌ZIP有18028项，解压总计700147814字节，检查未发现Lua/DLL/EXE/SO/NUT或上级路径。此检查不是对所有地图实体行为的安全认证。
- 仅提取BSP到游戏maps目录，以独占创建避免覆盖，CRC32与GMA索引一致；没有挂载整个第三方addon。压缩包与安装地图共约1.57GB，未超过8GB安装预留。
- 安全启动器新增明确白名单`--map rp_unioncity_day`，沿用鼠标/单实例/Job/超时保护。
- 首次实际加载成功，单组三摄完成，未残留游戏进程，无OS输入或模型调用。结果`run/gmod-unioncity-first-load-v1/result.json`；原图episode `D:/SteamLibrary/steamapps/common/GarrysMod/garrysmod/data/first_sight/20261029_212543_153/`。
- 已查看前摄：出生在地铁站台，画面有地面/灯光/墙面及海报，不是住宅。不能据此判断住宅家具、楼梯连通或全地图无缺失纹理。

下载与索引证据在`run/gmod-unioncity-download-v1/`。只读检查工具` scripts/datasets/inspect-gmod-gma.py`。接下来仍需住宅/商店勘察、连续正常步行路线、可见物品离开重访及保存恢复。尚未发布新的生活视频，原8884视频和服务保持不动；不把首次加载算作生活验收完成。
