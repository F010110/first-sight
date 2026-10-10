# v1.1.0-test.1：离线空间记忆实验快照

日期：2026-10-10。不是稳定发布，不替换 `v1.0.0` 的稳定版定位。

## 包含内容

- 此前积累的SceneAgent独立当前感知、身份验证和诊断；PlaceMemory schema-2持久化及可撤销维护。实时模块有改动，完整在线延迟/手机回归未验证。
- 观测优先Experience Graph，可修订关联、证据/拒绝历史、原子bundle、短序列回访核验。
- 视觉重叠聚类对照与有符号证据图的贪心multicut试验。
- 图像/轨迹审计、错误注入、精确小图对照、仿真录制重复路线与失败动作保护。
- 文献核查、实现清单和小体积数值报告归档。原建议文档保留，不当作论文复现。

## 当前结果，不能混淆

| 实验 | 结果 | 不代表什么 |
| --- | --- | --- |
| 短序列视觉关联 | 15/19同端点重访 | 不是Place颗粒度正确率 |
| 视觉重叠分组 | 24/21/17组 | 原地转向仍可拆组，不能作为主方法 |
| 人工布局证据分割 | 3粗候选、11未知；同位置14/19覆盖 | 不是自动空间感知成功 |
| 原图+逐步轨迹复核 | 床侧粗范围合理；通道漏覆盖；设施/台面局部粒度未验证 | 不应靠同房间或米数定义Place |
| 求解压力试验 | 强错误桥可过合并；200小图有19次贪心非最优 | 不是实际分组错误率 |

新Experience Graph/区域分割链路**没有接入**实时SceneAgent/RequestAgent，不提供导航许可。原始观察和待定证据保留。对象/segment自动轨迹、可信局部几何、边界穿越检测、独立区域标签、实时延迟验证仍缺失。历史物体出现不等于当前在场。

## 无数据可运行的检查

```powershell
npm.cmd ci
npm.cmd run test:memory
python sim/test_navigation.py
```

测试集共44项记忆/区域机制测试；Python导航测试另列。Python环境按 `requirements.txt` 配置；机制单测通过不等于在线服务回归通过。

## 有本地录制才能运行的实验

录制目录需包含 `windows.jsonl`、原始 `frames/left/right/triple` 图像；回访复用还需要 `experience-directional-evidence.json`；视觉分组需要 `experience-sequence-bundle.json`。路径默认指向本次val5录制，数据不随git发布。

```powershell
npm.cmd run sim:experience -- run/sim/multiview-val5-clean-20261007 --reuse --sequence
npm.cmd run sim:regions -- run/sim/multiview-val5-clean-20261007
npm.cmd run sim:regions:stress -- run/sim/multiview-val5-clean-20261007
```

序列输出可生成 `experience-sequence-bundle.json`；不要让新实验覆盖旧故障条件报告。区域入口的人工关系明文保存在 `src/sim/region-partition-eval.ts`，因此不属于自动提取器。

## 数据与版本管理

保留现有文件结构，添加实验索引而非大量改名。`run/`、模型权重、依赖、编译输出保持忽略；归档少量JSON便于提交后核对数字，不打包用户运行记忆或原图。保留旧稳定tag。本测试版使用独立预发布版本号与git tag；本地提交/tag不等于已推送或GitHub Release。
