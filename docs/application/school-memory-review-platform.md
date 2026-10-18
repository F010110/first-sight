# 学校8题人工审核入口

入口：`http://127.0.0.1:8879/`，学校直接页`http://127.0.0.1:8879/school-memory-v4-locked/`。本次启动本机8879服务，未外部托管。

## 难度分流

- 易处理2题：营业拒答flag漏检；第2段0秒检索地址不完整。已有日志证据，不需靠人工改参考答案。
- 先人工复核5题：3个当前场景分类、2个历史场景分类。分别检查用途臆测、回答过泛、结构／功能标签边界；历史两题均已获取正确原图，不能归为记忆丢失。审核前不把类别同义差异强行判错或改分。
- 困难1题：第8段26–80秒跨楼层。查看同段连续观察和楼梯证据；如模型可用信息不足，应判证据链/题目设计问题，不能用私有Z暗中喂答案，也不能只凭不同装修断言异层。

## 已装载内容与管理功能

学校10段、851观察组三视角、2553张原始PNG全部hash核验后加入独立只读审核包。优先hardlink到原文件以免复制大数据；没有改图、拼接新运动或补出未拍摄区间，不要手工编辑链接图片。8题原回答、错误、冻结参考、AI标注依据、原判分、实际查看ID与引用ID分栏显示。当前/历史参考图分别标注“已查看/未查看”和“已引用/未引用”。全样本按录像段及原秒数浏览，滑杆查看前后相邻观察；跨段间隔明确不连续。

统一入口保留家庭/HSSD及采集失败卡片，新增学校卡片，总9张；增加来源、可审核/采集失败筛选和显示数量。学校问题页支持难度、状态、文本搜索、上一题/下一题、人工归因、备注、未保存切换提醒；用户意见独立于冻结参考，保存不改标签或成绩。

审核数据仅保存本浏览器localStorage，键含冻结fingerprint，不能声称服务器已落盘。JSON导出用于备份/移交；导入校验protocol/dataset/fingerprint/题ID/状态/备注长度/时间，不同样本或版本拒绝，冲突以较新审核时间合并。原有页面存储键和记录不改。不提供一键删除或自动覆盖真值。

## 构建与检查

```powershell
python sim/build_school_memory_review.py run/school-spatial-oracle-v1/spatial-memory-runtime-fixed-v4 run/school-spatial-oracle-v1/spatial-memory-locked-protocol-v1 D:/Datasets/activity-benchmark-v1/school-memory-tasks-v2 run/review-site/school-memory-v4-locked
python sim/build_review_portal.py run/review-site
python sim/serve_review_site.py --directory run/review-site --port 8879
```

构建器要求新目录，拒绝覆盖已有审核包。`data.json`fingerprint `451cd5308707b356c0f74debe094aaec12a192bf467b843f63ed6e6233e0c6fc`。未运行付费模型、未改8题答案/标签/成绩。

验证：3项Python测试（原图hash/来源绑定/拒绝覆盖与篡改/入口兼容），3项Node导入契约测试；首页与学校页JS语法通过；本机首页、学校页、数据、抽样原图HTTP200，2553文件链接均存在。桌面浏览器未连接，因此尚未进行真实浏览器的图片放大、滑杆、保存/导入导出交互验收；不以stub DOM测试冒充浏览器验收。

现有portal生成器此前已有未提交的多样本首页恢复代码，本次在其上保留集成学校来源/筛选，并保存相关入口文件；未改或提交其他研究、README、TODO及采集脚本工作。
