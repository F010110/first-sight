# 校园网连接探测

## 后续：portal真实认证链已确认

用户报告电脑接portal可上网，并提供https://github.com/charlie0129/bupt-net-login。已只读审查README及master脚本，未安装或执行第三方代码。脚本为Bash＋curl：访问captive.apple.com，处理meta refresh／AC重定向，获取带参数认证页cookie，向index替换为login后的地址POST user/pass，再检查Success；不能直接在ESP32运行，也不能由电脑登录成功证明板上IP认证。

更新独立probe并编译、只写应用区成功，哈希验证通过。实板关联portal取得IP后：首次apple HTTP200带meta refresh且无Success；按网页跳转后的请求HTTP302 Location到`http://10.3.8.216`；最终认证页HTTP200且无Success。最多4跳，每页最多4096字节／3秒读取；不输出正文／cookie／完整查询参数。证据`cam/local/campus-portal-redirect-20261022.log`（包含串口启动乱码，不应当成协议证据）。当前板运行此有界portal探测，完成后关闭radio，非相机传图应用。

未提交本地凭据。观察到的认证链是HTTP，第三方脚本也是HTTP POST，用户密码在开放无线网络上可能被窃听；在明确告知风险并获得确认前，不发送密码，不关闭TLS验证伪装成安全认证。下一步可核实校方是否有可信HTTPS端点；若无，需用户选择继续现有HTTP认证或使用电脑2.4GHz热点。当前没有完成认证或图像传输，也未改电脑网络／防火墙。

## 后续：优先核对mobile

用户明确电脑使用BUPT-mobile，优先该路径。已确认本地凭据两个字段均非空，仅输出布尔检查，不记录值。开发板更新为**只扫描、不关联**的探测应用，连续3次2.4GHz扫描均发现BUPT-portal（频道1／6／11），均未发现BUPT-mobile。电脑同期只见mobile频道48／5GHz／WPA2-Enterprise。本地点本时刻无可见mobile 2.4GHz，因此未提交账号、未尝试猜测EAP参数或关闭证书验证；不能推断全校园没有mobile 2.4GHz。

原始设备扫描保存在`cam/local/campus-mobile-scan-20261022.log`。当前源码及板上应用均只扫描3遍然后关闭无线电，以下首次portal关联描述为历史结果。mobile企业认证与portal网页认证不同：普通WiFi.begin(ssid,password)不等于企业认证，凭据已填写不表示认证协议已实现。

2026-10-22单板COM3实测：BUPT-portal连接成功，频道1、RSSI -54，取得DHCP地址。无账号提交的HTTP连通性检查返回200而不是预期204，未记录页面正文或重定向参数，尚未确定登录协议、互联网权限或电脑互通。探测30秒关联超时，完成后关闭无线电；不开摄像头、不传图片、不调用模型。

账户填写位置：`cam/local/campus-credentials.json`（Git忽略）。username/password仅本地填写，**目前只是待用配置，没有自动登录实现**。确认实际认证端点、协议和安全传输后再接入；不得直接把密码提交给猜测地址或明文门户。此文件不是WIFI_PASSWORD：开放SSID关联无需账户密码，账号属于后续门户认证。

新增独立PlatformIO目标campus-probe，与camera/camera-wifi源文件隔离；只写0x10000应用区，未改bootloader、分区。当前板运行探测应用，重启会再次探测并关闭无线电，不是Wi-Fi相机固件。

备份：历史16MB备份hash已核验；本次完整16MB读回因120秒超时中断，不能当完整备份。随后成功读取当前应用区0x51000字节至`cam/local/pre-campus-app-20261022.bin`。编译探测目标后旧camera构建输出被清理，故与旧构建bin比较未能执行，但写入命令仍执行（PowerShell未因前一命令失败停止）；不应宣称本次读回已与已知应用hash比对。后续先验证读回镜像结构／备份完整性，再进行任何恢复写入。原历史完整备份未覆盖。

随后已用esptool image-info验证本次应用读回：ESP32-S3、DIO／40MHz／16MB，checksum及validation hash均valid；这验证镜像内部完整性，不等于已与历史构建文件逐字匹配。
