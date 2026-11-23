# TartanGround：答案先行的定位与路线QA

## 交付范围

正式冻结题集：`datasets/tartan-route-qa-p0006-v2/`。24题、35张已有原图、6个地点锚点、5条有向历史机器人通行边，无新下载。v1是保留的未冻结设计草稿，不作为评测集。

这是**单轨迹开发集**：位置标签定义为2米锚点邻域，而不是语义房间。参考图库预先登记，查询是相隔0.5秒的不同原始帧，不是在线因果建图、跨日重访或长期记忆测试。P0001暂不为了数量重复出题。机器人走过不等于视障用户安全可通行。

全部标准答案在真实推理前创建、验证并冻结：

|题型|题数|预先确定答案的方法|首轮严格得分|
|---|---:|---|---:|
|地点定位|6|官方pose：查询距唯一参考锚点≤2m，其他锚点≥8m|6/6|
|跨视角定位|6|同一规则，查询为左/右相机，参考为三视图|5/6|
|先定位再正向路线|4|正确位置＋冻结有向图唯一正向路径＋初始朝向差|4/4|
|反向路线未记录|3|正确位置，但图中无到目标的有向路径，必须拒绝编造|0/3|
|相机朝向对齐|3|当前图对指定参考图的相机yaw差|0/3|
|缺人体朝向|2|已知地点，但相机yaw不能决定人体转向|2/2|

反向路线题对模型仍为普通`localized_route`，不通过题型名称泄漏拒答标签；负例分类仅保存在私有gold。

`review.jpg`的35张图已在冻结前由助手检查，不冒称人工盲审。`gold.json`保留标准答案、几何依据与原始索引；验证器可从官方pose重新验证位置和朝向。没有使用基线预测制造标签。

逐题中文问题与答案可直接阅读 `datasets/tartan-route-qa-p0006-v2/questions-and-answers.md`；它只是从冻结文件生成的阅读视图，不是推理输入。

## 朝向与图的设计

官方来源：<https://tartanair.org/modalities.html>（NED pose）、<https://tartanair.org/tartanground.html>（相机/pose模态）。

- 每图分别使用其front/left/right相机四元数，不把前摄朝向复制给侧摄。
- 全部1504组pose校验归一化、同位置，以及left相对front约−90°、right约+90°。
- NED正yaw差表示向右，与旧独立原型的逆时针约定不同；朝向量化到15°。0是任意场景参考，不承诺地理真北，更不是人体朝向。
- 最短角差归一化到[-180°,180°)，绝对值≤25°为straight，≥155°为reverse，其余正右负左。模型与标准答案使用相同量化值。
- 边记录起点、终点、中途原图和理想轨迹起始0.5秒的运动方向（15°量化），不称为原始IMU。该方向只是实验性相机/运动对齐依据，不是人体执行指令。
- 这版图由数据制作阶段提供，不评测自动节点/边构建。序列用于边的原始证据，图用于定位后选路；两者并存。

## 独立最简基线

`src/evaluation/tartan-route-qa.ts`，与固定方法2、网页、现有数据库分离。

每题独立调用现成Qwen API：当前原图＋候选原图＋逐图朝向＋必要有向图。定位请求最多10张图；路线请求包括所有边的中途证据，最多12张。模型输入中不含精确位置、原始帧编号、私有答案或原始文件路径文本。Node推理进程不打开gold文件。

VLM自己输出placeId、path、turn、abstain、中文description和sourceIds。程序仅验证结构/ID/引用，不按坐标替它决定位置、不补正确路径。**结构合法不等于语义正确。** 第一版不微调，这个小开发集也不足以判断是否需要训练。

## 完整流水线与命令

```powershell
# 重建必须使用新目录；先审查review.jpg和答案，再freeze。
.venv/Scripts/python.exe scripts/datasets/build-tartan-route-qa.py --output NEW-DATASET
.venv/Scripts/python.exe scripts/evaluation/tartan-route-qa.py validate NEW-DATASET
.venv/Scripts/python.exe scripts/evaluation/tartan-route-qa.py freeze NEW-DATASET --review-note "真实审查说明"

npm.cmd run build
.venv/Scripts/python.exe scripts/evaluation/tartan-route-qa.py run datasets/tartan-route-qa-p0006-v2 --output NEW-RUN --confirm-paid

# 重新评分，不调用模型：
.venv/Scripts/python.exe scripts/evaluation/tartan-route-qa.py score datasets/tartan-route-qa-p0006-v2 --output run/tartan-route-qa-qwen-minimal-v1
```

流程：校验答案全覆盖及原图hash → 冻结public/gold/评分器hash → 推理并归档 → 全题评分 → JSON/Markdown报告。

- 推理前缺答案、答案与pose不符、图片或冻结文件改变均拒绝启动。
- 运行目录必须新建。manifest记录题集与freeze hash、源码/编译代码hash、模型和预算。
- 最多24次调用、USD0.50估算，transport重试也占额度；无自动协议修复/续跑。非法输出记协议失败，provider/预算/未知计费问题停止后续题；原响应/费用均保留。
- `predictions.json`从开始就包含全部24题；即使中断，外层仍尝试生成完整报告，未答/失败不从分母删除。
- 每题placeId/path/turn/abstain四字段全部符合标准才得1分。另按题型和字段报告；字段分数包含不适用字段的固定空值，只用于诊断。
- **中文语言质量、描述事实一致性和视障安全性未自动评分**，原文保存供复核；结构化分数不能冒充完整语言导航质量。

## 首轮真实模型结果

目录：`run/tartan-route-qa-qwen-minimal-v1/`。

- 24/24执行，17/24严格正确，**70.83%**；无协议失败/未执行。
- 24次调用，估算USD0.0166838196，未知计费预留0。
- 两类定位共12题的placeId全部正确；跨视角Q010把abstain误设为true，严格计错，不修补分数。其余部分地点已由题目给定，不能把全部24题placeId正确称为24次自主定位成功。
- Q020算出+105°却输出left；Q021对齐了错误的参考视角；Q022方向判断错误。3个相机对齐题全部失败。
- Q017文字拒答但path仍列出反向路线；Q018编造不存在的反向链，且description与path不一致；Q019文字说无路径但字段仍输出前向的无关路径。3个反向题严格全部失败。
- 正向链路4/4只证明这4道简单已给定拓扑题，没有证明复杂分叉选路、自动建图或安全语言指引。

原答案、提示、评分器与结果未因错误而修改，没有追加付费重跑。明确需要后续解决朝向运算、路径有效性检查与文字/结构一致性，而不是先扩大采样。

## 自动测试

本轮构建成功，全套328项TypeScript测试及9项专项Python测试通过。测试通过仅说明工程校验，不改变首轮模型17/24的成绩。

- `tests/python/test_tartan_route_qa.py`：9项，答案缺失、位置/朝向错误、冻结篡改、漏题分母、错答/满分、重复预测和边方向。
- `src/evaluation/tartan-route-qa.test.ts`：2项，模型可见数据隔离、引用/ID门禁、语义错误仍可评分。
- `run/tartan-route-qa-scripted-self-test-v1/`：24/24是**gold生成回复的评分器自测**，不是模型成绩，模式明确标记scripted。

本轮未做图像/朝向消融，朝向可能提供强先验，不能据得分断言全部定位来自视觉。尚缺真实重访、分叉拓扑、未知地点、长期恢复、自动建图、路线语言独立评分及真实人体朝向/实时安全验证。
