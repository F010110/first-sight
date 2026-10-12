# 人工视频审查网站与扩展样本

本地入口：`http://127.0.0.1:8879/`。这是本地检查网站，不是已部署的公网服务。

已生成两套包：val4含57样本/171连续三视图帧，val5含40样本/121帧，共97样本/292帧。视频2帧/秒只是离散模拟帧展示速度，不代表真实运动速度，不插值制造轨迹。

页面支持播放/暂停、倍速、逐帧、进度拖动、样本按钮跳转、查看样本原三视图。算法最终预测和已有AI审查标签分开展示；边界显示单独状态与关系，未定组不冒充区域。val4旧AI标签区分厨房/客厅，当前算法采用开放生活区粒度，二者差异可见，不自动改写。val5没有完整AI审核标签，显示待审。

人工填写明确区域/边界/证据不足及区域身份、邻接身份、原因、审查者，按点保存到浏览器localStorage，再导出带图像hash、预测报告hash及时间的JSON。原AI标签/图片不改动。各区域要使用具体实例ID，不能用“两个卧室”同一类别代替身份。页面展示AI提示，所以导出明确`blind=false`、`assistedByAI=true`，不能当独立盲审。

区域预测目前为研究性整段最终结果，不是视频当时可用判断；采样点视频时刻=原endTick/fps。生成器严格要求完整连续图像和模拟回放observation编号，不将稀疏图片冒充连续视频。后续真实头盔时间轴需另实现对应导入。

## 生成与启动

```powershell
python sim/build_region_review_site.py run/sim/region-val4-multiview run/sim/vlm-boundary-groups-val4-flash-v1/report.json run/review-site/val4 --labels docs/experiments/region-val4-core-labels-v1.json
python sim/build_region_review_site.py run/sim/multiview-val5-clean-20261007 run/sim/vlm-boundary-groups-val5-flash-v1/report.json run/review-site/val5
python sim/build_review_portal.py run/review-site
python -m http.server 8879 --bind 127.0.0.1 --directory run/review-site
```

生成器拒绝覆盖已有包，重跑需新输出目录。依赖现有imageio_ffmpeg。HTTP只绑定本机，默认不暴露给局域网；需要分享时另配置受控部署，不能暴露整个仓库或密钥。视频、大图和导出的人工文件不随代码提交。

## 扩展val5的真实模型结果

同固定边界协议，23局部组/31代表三视图，一次qwen3.8-flash调用。模型提出3区域、1边界聚合（原G21/G22）和3组内边界观察。但原输出有10组缺各自核心引用，严格校验首次失败；原API回答保留，不重复付费调用。确定性安全隔离这10组为未定，输出仍保存`rawProtocolValid=false`。最终40观察中24主体、5边界、11其他未定。

val5完整区域标签尚缺，正确率为null/证据不足，不把“看起来3区域”或没有已审混组解释成成功。此次扩展暴露了输出协议依从性问题；网站会显示隔离警告，便于人类检查是否实际上有视觉证据、是否需改善提示或引用协议。

## 检查范围

生成器/边界安全隔离单测及离线回归通过。当前会话没有连接桌面浏览器，无法完成浏览器内交互验收；HTTP、HTML和视频资源检查与浏览器交互测试应明确分开。人工导出导入评分的自动审核与公网多人协作仍未实现。
