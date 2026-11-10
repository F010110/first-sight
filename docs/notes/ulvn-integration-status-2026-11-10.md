# ULVN图像匹配实验：提交检查点

本次保存实验实现，不是稳定版本或准确率提升认证。默认保留legacy；主空间Agent、长期记忆与独立问答职责不变，不接BPL/BASS。

## 已验证

- MegaLoc＋SuperPoint/LightGlue＋基础矩阵RANSAC，实际CUDA运行成功。
- 固定模型revision、准确当前/历史图对、进程超时、有界缓存/几何预算及显式失败；保留原评测口径。
- 3批×2后端×2遍本地对照12次成功。暖耗时：legacy 3.00/13.48/32.88秒，ULVN 5.19/6.81/7.17秒；ULVN首次含加载下载65.24秒。
- 初查共同建筑表面匹配有改善迹象，但餐厅/后巷旧ID不等于当前占据区域；尚无准确率优于旧后端的结论。
- 构建及针对测试通过；安装说明见 `scripts/media/ULVN-MATCHER.md`。

## 尚未验证

- v10配对VLM实验已启动：3批×2后端×3重复，最多60请求/$2。用户要求暂存当前工作时仍未收齐、审核结果；不得写成完成或认证。
- 该迭代器是冻结Context及有限工具模拟，不是真实持久Pi/SQLite全链路。整批语义分组、误复用、误新建、段界须另审。
- 96几何图对预算对60当前图并未覆盖完整top4；不同算法inliers/相似度不可直接当准确率比较。

## 本地证据（不上传原图/运行数据库/权重）

- 旧调参冻结：`run/spatial-tuning-frozen-20261110-v9/manifest.json`（52源文件，7报告hash绑定）。
- 前端对照：`run/ulvn-visual-prefix-probe-v1/`，含plan、pip freeze、原始结果、图对接触图与findings。
- 后续VLM：`run/unioncity-batch40-revisit-ulvn-v10-paired/`，保留每次请求、交付证据hash及失败。

下一步先收齐v10、独立审核分组，再决定是否开展真实服务全链路；不恢复无终点的小样本提示词调优，不自动切换默认后端。
