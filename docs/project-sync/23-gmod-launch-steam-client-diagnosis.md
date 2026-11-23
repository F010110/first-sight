# GMod无法启动：Steam客户端版本诊断

2026-10-29。用户安装游戏后要求排查，期间明确授权正常退出/重启Steam以应用官方更新，不重启电脑或重装游戏。

## 已确认

- 游戏安装根目录`D:/SteamLibrary/steamapps/common/GarrysMod`，Steam App4000，build25375506，清单显示下载和安装完成，本体约7.33GB。准备收据：`run/gmod-readiness-launch-diagnosis-v1.json`。
- 我们的三摄Addon仍**未复制**，因此不能归咎于采集插件。D盘约76.8GB空闲，不是容量已满。
- Steam记录用户先前三次32/64位启动均exit1；没有游戏console.log或Windows应用崩溃记录可用。诊断期间额外执行两次64位窗口化启动，后一轮在1.5秒读取到实际错误对话框：`Failed to initialize Steamworks API. No SteamClient023. Make sure Steam is running and is up to date!`。用户反馈多个失败弹窗后停止重复启动。
- Steam当时正在运行，但steam.exe/steamclient64.dll仍为2025-04文件、版本09.65.07.86；官方bootstrap日志显示客户端更新已下载尚未应用。隔离进程正常加载游戏64位tier0/vstdlib/steam_api64/launcher DLL，无直接DLL缺失错误；这不代替完整游戏初始化检查。

## 已执行修复与当前阻塞

用户授权后用`steam.exe -shutdown`正常退出，未强杀Steam；正常重新启动，官方更新器先应用已下载约326MB更新，再自动获取/应用约240MB后续更新。最终核心文件更新为2026-10-22、版本11.15.70.27，bootstrap显示更新完成。未手动下载替换DLL、未关闭系统安全设置、未删配置/缓存/存档，未更改Steam持久启动参数。

更新后仅重试一次64位窗口化GMod，仍exit1；随后检查到Steam停在登录窗口，当前尚未认证。**因此只确认Steam过旧这一前置问题已修复，尚未确认游戏能启动，不把仍退出说成成功。** 不读取登录信息，等待用户自行完成登录/Steam Guard，再启动一次验证主菜单。

尚未安装Addon、未加载生活地图、无三摄采集或模型调用。旧实验、8884、独立research工作保持不动。
