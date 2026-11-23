# 校园主样本路线纠偏

用户指出ReplicaCAD屋顶画面不完整，且单公寓不符合校园场景。当前公寓样本仅保留为技术验证，不作为校园长期主样本。尚未定位顶面问题究竟是资产几何、背面剔除还是渲染配置，不应简单补平面后宣称场景真实完整。

## 旧校园样本实际如何构造

依据 `sim/school/build_activity_samples.py`、`sim/school/build_campus_continuous_video.py` 和本机 `D:/Datasets/activity-benchmark-v1/school-offline-v1/school-rounds/complete.json`：

- 来源是TartanGround的AbandonedSchool预渲染机器人轨迹，不是真实学校实拍，也不是本机新建校园。固定revision为388faf9c800568cfc6828fa47e063f8369397eb3。
- 10段独立源轨迹，有效视觉1669.7秒（27分49.7秒）；日程跨度12469.7秒（3小时27分49.7秒）。段间20分钟是明确合成的未观察空档，不能当实际视觉内容或通勤证据。
- 模型采用约0.5fps的851组观察、2553张原三视图；回放另用原生10Hz图像编码视频。不是把模型稀疏图重复为高帧率。
- 回放布局原本为前图640px、两侧各320px；源位姿与轨迹身份只用于私有溯源，不送模型。
- manifest仍标注indoorOutdoorVerified=false、scoreEligible=false；学校名称不能证明完整校园、楼层连通或生活状态变化。

## 建议11的三类路线需分开

EgoLife用于真实跨日生活；AEA用于同地点跨序列空间重访；HM3D用于真实扫描基础上的可控相机。三者都不是现成完整校园整日三摄样本。已有EgoLife三小片共77.6秒不能当长期数据已备齐；AEA需要用户完成注册/许可；HM3D完整访问需遵循Matterport流程。不得用位姿或原QA答案充当模型输入。

## 更贴合校园的真实来源：CODa

本轮直接核查官方页面：

- 项目：https://amrl.cs.utexas.edu/coda/
- 下载：https://ut-amrl.github.io/coda/download.html

官方介绍UT Austin校园真实机器人采集8.5小时，多次经过相同位置，覆盖室内外、不同天气及时间；提供同步双目RGB、RGB-D、IMU和全局一致伪真值位姿。8.5小时是数据集累计量，不等于单条连续路线。只有58分钟带所述对象框等真值标注，不可把全部8.5小时当全面人工标注。

官方提供tiny/small/medium/full及按sequence下载，完整约4TB，并有RGB-D专用下载。许可CC BY-NC-SA 4.0，另受Dataset Terms约束。当前只核查文档，没有下载CODa或代替用户接受许可。双目不是前左右三方向，不补造侧面；真实数据应按原相机布局回放。

推荐先审查序列清单、实际时间戳、图像体积、路线重叠及许可要求，选择同地点两段真实重访，而不是全量下载。CAD公寓增加停留不再作为校园长期进展；优先增加真实有效观察时长，并分别报告日历跨度、有效视频时长、独立路线与场景覆盖。
