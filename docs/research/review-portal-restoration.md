# 统一审核目录恢复

服务已恢复`python sim/serve_review_site.py --directory run/review-site --port 8879`，根入口`http://127.0.0.1:8879/`不再自动跳入HSSD。

首页8张采集卡片：家庭val4/val5＋6个计划HSSD场景（5有效/1采集失败）。可搜索编号/来源/名称，分别进入逐点标签审核与按scene直接选择的HSSD视频审核。页内列表滚动，body不滚动；各现有审核页补“返回全部样本”。路径未移动，localStorage键、审核记录、原图/预测不改。

`build_hssd_video_review.py`生成后调用统一portal builder，不会下次悄悄恢复旧根跳转。原逐点datasets.json兼容格式保留。用途名称只是原候选说明，不证明建筑类型；页面提醒现有预测为早期结果，基线结果链接不假冒最新实验。

`python sim/audit_review_portal.py`通过：8卡片、全部链接HTTP200、视频Range206/1024字节、主页/视频页JavaScript UTF8语法。桌面浏览器未连接，真实播放/搜索/回首页/scene选择与审核保存交互未能浏览器验收，不能以HTTP检查冒充。
