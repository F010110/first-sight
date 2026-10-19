# 补测：实际空间记忆检索与证据Oracle

用户纠正：旧三个条件均是访问范围基线；应加入实际空间记忆算法，并将理想完整记忆作为oracle上界。不能继续把旧full-history三卡称为空间记忆算法成绩。

## 两个隔离实验组

- **spatial-memory**：只读复用851观察真实空间v2算法建立的库，问答实际调用现有`src/agent/spatial-retrieve.ts`的`SpatialRetriever.session/search/inspect/validateCitations`。可用模型判断关键词、算法placeId与时间范围检索。工具新增暴露原本已支持的placeId与时间参数，不注入参考证据。每次实际调用有trace。
- **memory-oracle**：评测器从私有参考集合选择正确原图，提前实际inspect并把最多6张参考图直接送入回答模型，附证据ID；不要求模型先找到它们。只提供图像而不提供参考答案文本。对不可知控制不提供支持图，这属于privileged oracle，不是可部署算法或公平检索基线。应接近满分；失分需区分图像理解、回答协议与判分，不归咎于记忆检索。

空间组和oracle分属独立运行目录、独立进程。只有oracle目录含`oracle-evidence.json`，由hash冻结；空间组不读该文件。判分在独立进程读答案，两组沿用旧题库与评分量表。已有基线原文件不覆盖。

## 因果与边界

公开时钟桥只把问题中“第N段T秒”转换为公开观察的活动时间，再交给真实SpatialRetriever时间范围查询；不是按私有答案挑图。未来观察仍被截止时刻拦截。未完成窗口的联合判断被掩蔽：原图可读、reason/placeId不可读，不得让未来窗口内容泄漏到过去问题。identity/baseline/path也屏蔽这些尚不可用身份。

**重要限制**：旧90题多为指定时间记录的粗属性问题。即使接上真实retrieve，该题库也不能充分证明地点合并、跨段重访、导航或状态变化能力；时间查图可能绕过身份组织。这轮只声称测到“真实空间库＋已有retrieve的问答链”，后续地点关系任务仍须单独补充，不能用接了类名就宣称完整空间能力已测。

## 运行

`run/school-spatial-oracle-v1/{spatial-memory,memory-oracle}`各自先6题冒烟与判分，再90题全量与判分；总计12冒烟＋180全量问答。模型仍为qwen3.8-flash、enable_thinking=false。新执行器/真实retrieve/适配器/判分器共7个编译文件在预测前hash冻结。

复用建库不重新计费。每组冒烟问答USD0.5、冒烟判分0.2、全量问答3、全量判分1.5的公开价预算上限，共两组USD10.4；请求与token上限同样执行。不是账户账单硬限保证；遇系统异常仍停机留档。六项TS测试覆盖实际retrieve、时间桥、place关联、未来判断屏蔽、原图验证、oracle证据隔离及RequestAgent真实mock工具链。

实际进度以两组各自complete/stopped与usage文件为准；本文件不宣称补测已完成。
