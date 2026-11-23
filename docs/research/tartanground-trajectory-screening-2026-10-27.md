# TartanGround逐轨迹筛选：2026-10-27

相机动态网络恢复按用户要求暂缓，本轮不修改硬件、服务或research/。

## 固定来源及方法

- 官方HF仓库theairlabcmu/TartanGround，revision `388faf9c800568cfc6828fa47e063f8369397eb3`，gated=false，license=cc-by-4.0。
- 官方树API精确读取ModularNeighborhoodIntExt、ModernCityDowntown目录，并保存清单；未下载全库。
- 元数据ZIP校验LFS SHA256/大小；住宅两条元数据另完成ZIP CRC检查。位姿/配置/元数据只留datasets对应private目录，不进入模型输入。
- 新工具`scripts/datasets/screen-tartanground-ranges.py`通过HTTP206严格范围读取ZIP目录及16张前视原图，每次运行24MiB预算；每成员CRC由zipfile验证并保存本地哈希，**未下载完整ZIP，不宣称整包SHA256验证通过**。原始失败输出保留。

## 实际结果

| 环境/轨迹 | 元数据num_poses | time_step | 帧数×步长名义时长 | 三路原始ZIP总字节 |
|---|---:|---:|---:|---:|
| ModularNeighborhoodIntExt/omni/P0000 | 536 | 0.1s | 53.6s | 1161673402 |
| ModularNeighborhoodIntExt/omni/P0002 | 2480 | 0.1s | 248s | 5254687179 |
| ModernCityDowntown/omni/P0000 | 651 | 0.1s | 65.1s | 1106342153 |
| ModernCityDowntown/omni/P0001 | 1129 | 0.1s | 112.9s | 1801042145 |

“帧数×步长”不是原始独立曝光时间戳验证；首末帧跨度分别为(N-1)×0.1s，不混为全天生活时长。住宅两条ZIP前视图像数量与num_poses一致，都是640×640。

住宅P0002实看均匀分布16帧：住宅街道、树木、车辆、院落、建筑外墙和门廊；P0000另看16帧亦主要室外街区和院落。**没有在这32帧中看到明确进入室内的证据，不据此排除两采样点之间的短室内片段，也不认定已完成连续室内外路线验收。**有外观重复，不作为独立地点重访真值。暂不下载这两条完整三路大包作为主样本。

实际范围读取P0002=11591839字节，P0000=11275261字节。接触表及逐成员收据：run/tartanground-neighborhood-P0002-screen-v1、run/tartanground-neighborhood-P0000-screen-v1。约23MB前视初筛避免先取约6.4GB三路包。

ModernCity元数据获取在完成P0000/P0001后遭TLS握手EOF中断；P0001图像筛选也因TLS EOF仅完成首张（run/tartanground-moderncity-P0001-screen-v1/failure.json）。未关闭TLS校验，未把失败当完成，不从一张画面推断路线。

## 下一步

用户要求继续取图并接统一模拟回放后，新增有限TLS传输重试（不禁用证书验证）；ModernCityDowntown/P0001的16张前视已完整筛选成功，范围读取7963285字节，输出run/tartanground-moderncity-P0001-screen-v2。画面为城市道路、广场、建筑外立面与暗通道/入口附近，仍不认定已验证连续室内路线。

已启动完整三路1129组采集任务，精确清单1801042145字节，2GiB下载规划上限；目标datasets/tartanground-moderncity-P0001-complete-v1和run/replicacad-pilot/tartanground-moderncity-p0001-v1。仅全ZIP SHA256、逐帧CRC/640×640解码、三视图源编号对齐和视频生成完成后才发布manifest。失败目录及partial保留，无模型调用。本文此条为启动记录，不等于已完成；以目标receipt.complete及就绪manifest和后续浏览器验收为准。

### 完成及网页验收

完整三路下载完成（前路一次传输中断后续传），三个ZIP的大小及固定LFS SHA256全部通过；1129组三摄、3387张640×640 PNG逐成员CRC/解码及源编号对齐通过，就绪manifest已发布。前视H.264 MP4已生成，另完整解码核验1129帧通过。

现有8884运行服务已在“回放/模拟”同一下拉框列出`tartanground-moderncity-p0001-v1`。Chrome实际验证三张原图加载、定位到第600帧（60秒）及继续播放通过；前图宽780、侧图260，页面无异常。无需重启用户服务即可读取新归档。该服务若仍运行v2.1.0旧构建，其API内部provenance.source仍可能沿用ReplicaCAD默认；页面scope与title明确真实来源，源码已修正，下一次正常重启后更新API来源，不为此擅自打断用户服务。无模型调用。

1. 对其余住宅轨迹先读元数据/少量前视，寻找确实进入住宅或其他建筑的轨迹；不再依赖IntExt名称推断。
2. 网络恢复后继续ModernCityDowntown前视筛选。可以给范围工具补有限传输重试，但不得放宽Range校验、体积上限或TLS。
3. 只有前视适合才取同轨迹同索引左/右，验证编号集合、分辨率及相机参数；再决定是否完整下载/接网页。前/左/右方向来自lcam_front/left/right，lcam的left表示双目侧，不等于只取物理左视图。
4. 当前没有合格的新长时间室内外生活主样本，没有新模型调用或算法分数；不修改已冻结v2.1.0标签。

## 地图与标注底图

ModernCityDowntown确实有地图级数据。官方HF目录（同一pinned revision）提供：

- `ModernCityDowntown_rgb_pcd.zip`，246331746字节，SHA256 `a2376e90b32327d31b2942ceb7d9446b2d5946dca664dfc315561102207f58dd`；已完整下载并校验。
- `ModernCityDowntown_sem_pcd.zip`，1030244050字节，64390232点；只核对了ZIP目录和PCD头（x/y/z/rgb、binary），**未完整下载**，不能称已完成语义底图。
- `seg_labels.zip`，2370字节，SHA256 `4a9e954f0f93f66726b0954bfdc2d0029c9c793b1115959b8c0dd4fef9e89607`；含`seg_label.json`和`seg_label_map.json`。

RGB点云为15395713点、16字节/点、PCD binary，覆盖范围约x -146..105、y -171..121米。地面点（z 2.45–3.2）占2,471,262点，但2D栅格覆盖率仅约11.3%，因此底图会有稀疏和空洞，不是完整建筑内部平面图，也没有房间多边形真值。PCD坐标与P0001位姿的x/y对齐；z不能直接按位姿高度解释，已用点云地面层作栅格，不据此测楼层高度。

已生成：

- `datasets/tartanground-moderncity-map-v1/annotation-map-route-area.png`：0.1米/像素、5米网格、x/y米制坐标、P0001轨迹及起终点，便于人工圈注。
- `annotation-map.png`：较大范围上下文。
- `route-P0001.geojson`：世界坐标轨迹，仅供人工标注，不与模型输入混用。
- `map-metadata.json`、`speed-comparison.json`、`seg_labels.zip`、`README.md`。

底图由稀疏点云投影得到，能辨认道路、庭院、建筑轮廓和轨迹，但**不是测绘平面图**；不能把空白当未占用空间，也不能把点云外观当独立房间/楼层真值。语义点云和标签可后续用于分类底图；若下载完整sem_pcd需另行核对体积/内存和标签编码。

## 速度问题

P0001实际约3.43米/秒（387.3米/112.8秒），逐帧中位速度3.10米/秒；只有约4.2%帧速度≤1.2米/秒，没有可用的长慢速连续段。把它当视障用户步行样本会把每帧位移和采样间距放大，确实不合适；不能只改播放倍速来修正数据采样系数。

ModernCity各轨迹平均速度实测：P0000 2.955、P0001 3.433、P0002 2.004、P0003 3.439、P0004 1.758、P0005 3.458、P0006 1.543、P0007 3.552米/秒。P0006中位1.191米/秒、约50.3%帧≤1.2米/秒，30秒最慢窗口约0.686米/秒；P0004中位1.511、约35.1%≤1.2、最慢30秒0.645。P0006是更接近慢速步行的候选，但仍不是视障用户实测步速，且16帧前视仍主要是城市室外。建议另采P0006作为速度对照，不覆盖P0001工程样本；若需要慢速连续段，必须保留原始时间戳并明确它是片段，不得拼接或改时钟。

前端已增加0.25×/0.5×播放选项，仅用于人工查看的慢放；不改变原始10Hz、采样间隔或时间戳，不能当作修正后的步行速度。P0001仍是机器人速度样本。

## 下一步

1. 将以P0006为速度对照候选，先完成三路完整采集和地图叠加，再与P0001分开标注。
2. 若标注需要语义类别，评估下载sem_pcd并验证标签编码；不要把稀疏RGB底图的颜色当类别真值。
3. 缓慢播放只作为查看功能；评测采样必须按原始时间/速度记录，或另选真实慢速轨迹。
