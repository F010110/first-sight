# 3D-Mem位姿误差关联实验：环境决策记录

## HM3D不可用

3D-Mem官方A-EQA／GOAT需要HM3D。HM3D须本人注册Matterport并接受学术许可；本项目未完成该步骤。助手不代签、不绕过、不下载未授权资产，因此暂不产出原版benchmark分数。

## ReplicaCAD场景适配（仅管线／关联诊断）

项目已有ReplicaCAD v2资产。为与3D-Mem原版无Bullet环境一致，采用：

- habitat-sim 0.2.5 headless（无Bullet），与官方README一致；
- 生成只读静态场景实例：复制`apt_1`实例配置，移除6个`articulated_object_instances`，其余120个刚性物体、灯光和官方`navmeshes/apt_1.navmesh`保留；
- 新scene dataset config放`research/data/replicacad-static/`，以上游数据为绝对只读路径；
- 上游数据集未修改。

尝试过headless+Bullet构建：加载可动家具失败，且启用相机渲染时段错误；该构建在此WSL环境不可用。改用静态实例后不需要Bullet。

## 这不是原版复现

场景（ReplicaCAD而非HM3D）、物体集、类别表运行方式、轨迹、相机位置均由本实验指定。问题集和官方评分不参与。结果只能说明3D-Mem映射函数在该场景对位姿误差的敏感性，不能写成A-EQA／GOAT分数，也不能直接推广到HM3D。

## 后续门槛

关联实验完成后，是否申请HM3D并运行原版A-EQA／GOAT，取决于用户本人完成许可及资源决定。
