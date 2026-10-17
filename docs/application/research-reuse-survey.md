# 建议10：现有研究与可复用算法核查

核查日期：2026-10-17。区分源码存在、预训练接口存在、本机跑通三个层次；本次没有安装模型、下载权重或运行算法，不宣称效果已验证。

## 建议中的五项研究

| 研究 | 官方入口 | 发布情况及对本项目的用途 |
|---|---|---|
| UCS-Bench / DirectMe | https://github.com/cocowy1/UCS-Bench | 已拉取源码树并读取mapping/keyframe_selector.py、place_induction.py、configs/default.yaml等。包含感知适配、建图、SQLite、检索、QA及评测实现，最值得作为完整系统基线。 |
| EgoMonth | https://huggingface.co/datasets/EgoMonth/EgoMonth-dataset | 数据页提供scripts、样本视频、QA及外部全量视频入口；本次未确认独立官方GitHub算法仓库。主要是评测数据/推理脚本，不是可直接接入的空间记忆算法。 |
| MeMoREval | https://github.com/jimwang418/MeMoREval | README明确写完整simulation/skills/memory backends/agent/grading代码将在同行评审后发布。目前任务JSON、场景和机器人资产公开。不能称完整开源记忆算法可立即运行。 |
| EgoLife / EgoRAG | https://github.com/EvolvingLMMs-Lab/EgoLife/tree/main/EgoRAG | 已检查源码树及egorag/agents/RagAgent.py。实际实现Chroma字幕向量库、日/小时摘要定位、时间过滤检索、原视频证据抽取、回答。适合长期经历问答，不负责稳定房间身份。 |
| LMEE / MemoryExplorer | https://github.com/wangsen99/LMEE | README提供训练/评测入口及模型链接，依赖Habitat-Sim、HM3D-Sem、PyTorch3D等。与当前资产授权和Habitat设备权限阻塞相撞，不优先整体迁移。此项本次仅核查发布说明，未运行实现。 |

## DirectMe并非“现成的无定位房间身份插件”

源码克隆到`D:\Datasets\research-code\UCS-Bench`，未初始化大模型子模块；EgoLife源码树在同级目录。未向First-Sight复制第三方代码。

- `directme/mapping/keyframe_selector.py`：CLIP/DINO embedding余弦距离上的贪心最远点采样，选多视角代表帧；默认budget=4、候选pool_cap=16。无embedding则退化为bbox面积选择。这是代表证据选择，不是VLM调用门控。候选embedding池只在内存中，重启行为不能照搬为我们已有的持久化保证。
- `directme/mapping/place_induction.py`：先按scene_tag分组，再按世界坐标质心做贪心半径聚类，默认半径3米。不是墙体/房间边界算法，也不自动区分相邻同类教室。
- 该函数每次从`place_000`重新编号并替换place_nodes，不能直接视为跨修订稳定的历史身份系统。
- `perception/adapters/scal3r.py`提供视觉重建得到depth/pose/intrinsics的适配。它不必依赖IMU积分，但确实需要几何估计及坐标对齐。不能把evaluation-only真实位姿偷偷接进去后声称纯RGB算法。
- 完整复现涉及深度/重建、检测跟踪、分割等依赖；需先跑作者小demo，再评估三摄与2秒稀疏输入适配，不能假定在线实时或跨天一致性已满足。

## 可直接采用的成熟基础算法

### 1. 视觉地点检索：优先SALAD，AnyLoc作备选

- SALAD：https://github.com/serizba/salad ，已读官方README及`hubconf.py`。有预训练Torch Hub接口`dinov2_salad`；默认预训练支持DINOv2 ViT-B/14。无需先自行训练，输入RGB，输出全局描述子，可替换当前72维颜色特征。
- AnyLoc：https://github.com/AnyLoc/AnyLoc ，官方提供DINO等特征＋VLAD聚合及演示。可用于室内外检索基线，但VLAD词表/缓存有配置和域适配成本，并非无条件即插即用。
- 两者不需要真实位姿。先逐相机检索再做有界候选聚合，三摄融合方案必须实测。模型相似分数不能直接当物理身份置信度。
- SALAD训练域及AnyLoc域覆盖不等于本校场景保证；逆向视角、相似窗户/教室、遮挡必须保留负例。

### 2. 候选验证：ALIKED或DISK + LightGlue + RANSAC

- 官方仓库：https://github.com/cvg/LightGlue 。README提供推理代码及多个预训练匹配器；可输出对应局部点，再用标准RANSAC估计几何一致性。
- 作用是为历史候选提供“哪些具体图像区域匹配”的可审计证据，不依赖模型随口解释。只验证少量候选，避免两两全量计算。
- 跨门可见、同立面远距离、纯旋转都可能匹配；匹配成功不证明同一物理房间、同一观察位置或可通行。匹配失败也不证明新地点，应保留unknown。
- 许可需要分开处理：LightGlue代码/权重Apache-2.0；SuperPoint另有较限制许可；可先评估ALIKED（BSD-3）或DISK组合。其他上游权重也要逐一保留条款。

### 3. 代表证据与历史问答

- 采用DirectMe已实现的embedding多样性选择思路，作为独立可比基线，不再仅用first/last或颜色相似；保持原图来源和持久化恢复，不能用临时匹配图改写原证据。
- 采用EgoRAG“分层时间摘要→向量检索→原视频/原图复核→带证据回答”的成熟流程，对接现有RequestAgent。
- EgoRAG源码含数据集特定日期/文件命名、外部GPT调用及异常时随机选项回退；这些是需要适配/禁用的评测实现细节，不能原样作为可靠产品行为。字幕错误不能覆盖原图，摘要窗口不得包含查询时刻之后的信息。

## 建议的实施顺序：复用而不是重新发明

1. 保留当前失败案例和冻结v1。先搭建隔离的SALAD描述子适配，与原颜色检索在相同90组上做离线对照；首次不花VLM费用。
2. 加入有界LightGlue候选复核，分别评价检索召回、几何匹配和最终身份；尤其保留“已召回但VLM仍新建”的100/116秒失败，单换检索器并不能解决它们。
3. 新地点只有在证据不足以复用旧节点时才进入候选/unknown流程；成熟检索/几何模块辅助决策，VLM负责语义和歧义，不再独自承担所有身份管理。语义房间边界仍需验证，不能拿阈值自动合并。
4. 独立跑DirectMe作者demo，作为另一条完整系统基线，不同时替换生产链路；若几何依赖可满足再适配学校输入，清楚区分预测定位与评测真值。
5. 长期经历问答接EgoRAG式检索；MeMoREval/EgoMonth用于评测设计和外部数据，不等待未发布代码，也不先做LMEE强化学习。

结论：现有算法足够启动工程复用，不需要原创地点识别/检索算法。尚无证据证明上述任一仓库可以不加适配地满足三摄、2秒采样、动态环境、历史修订、低预算及稳定身份全部要求。
