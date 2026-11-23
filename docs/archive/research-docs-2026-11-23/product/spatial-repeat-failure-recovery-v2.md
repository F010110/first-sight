# 重复实验失败诊断与v2重启

## v1失败原因（不是总预算／调用数耗尽）

- recall第一遍请求0060返回有效JSON但遗漏groupId，后续0061仍执行，最后全组evaluate才报Malformed group page decision；62请求／256，未知计费0。
- graph第一遍请求0043同样遗漏groupId，0044后才在evaluate报错；45请求／256，未知计费0。不是图语义冲突引发协议异常，不能据此判图差。
- sequence第二遍请求0023，transport-failure-0 retrying=true，transport-failure-1 retrying=false。网络helper最多3次，仅已知临时网络错误会重试；第二次可能不符合分类，旧日志只记String(error)，无法恢复cause，不能声称已用完3次。该轮25请求／256，两笔无usage请求各预留USD0.0178152，保留合计USD0.0356304。网络异常使原批次按未知计费保护停止；原账本USD0.2567298132包含这些预留，不是实际发票。

原有其他Agent的回退不等于此独立实验入口已接通格式重试。此入口此前只有网络分类重试，没有checkPage协议回退。

## v2修复及边界

独立runner启用protocolAttempts=3；每页返回立刻核验groupId/version/pageIndex/currentId、完整成员比较／合法relation／引用及非空证据。失败提供纯协议反馈，用相同原图／固定scope重新请求，不补字段、不纠正ID、不把conflict或uncertain当错误。每次原始请求响应保存为独立receipt，仍计入256调用／USD0.50单轮上限；3次均无效则该轮失败，不追加成员。默认未启用的其他调用者保持单次策略。JSON解析、未知别名或其他模块错误仍可能中止，不宣称覆盖所有失败。

网络helper补TimeoutError、临时DNS EAI_AGAIN及路由不可达的有限重试，最多3次。保存每次cause链name/code，不泄露请求凭据；不盲重试所有TypeError、HTTP／认证／语义失败。新增源码冻结包含bounded-network-retry.ts。

批次默认仍在未知计费时停止；v2显式SPATIAL_BATCH_ALLOW_RESERVED_UNKNOWN=1后，允许在保留所有未知请求最大预留的前提下继续下个独立计划轮。不是免计费或消除未知账单，也不续接失败轮。单轮异常／缺收据及未能核算费用仍停止。

## 已重新启动

新目录`run/spatial-repeat-batches/campus-episode6-3methods-3repeats-2026-10-22-v2`，三方法各3个新空库，共9轮；不使用v1的成功轮来凑数，不拼接失败。当前33观察片段及轮换顺序不变。新整批预算USD4.24，连同v1保守估算合计最多USD4.4967298132；每轮启动前仍预留USD0.50，不满足余量会提前停止，不保证预算内必能完成9轮。冻结代码改变也停止。

shell `sh_163659b90001ervqBpR43TGXZm`，已核实首轮running。以status.json／complete.json／stopped.json为准，不重复启动；保持方法2默认和旧前端三轮不变。新增测试：遗漏groupId先失败后重新判断、冲突仍否决；三次格式错误不变更内存；超时三次封顶。完整300项测试通过，修复不等于空间准确或重复稳定性通过。
