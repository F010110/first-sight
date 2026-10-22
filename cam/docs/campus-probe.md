# 校园网连接探测

2026-10-22单板COM3实测：BUPT-portal连接成功，频道1、RSSI -54，取得DHCP地址。无账号提交的HTTP连通性检查返回200而不是预期204，未记录页面正文或重定向参数，尚未确定登录协议、互联网权限或电脑互通。探测30秒关联超时，完成后关闭无线电；不开摄像头、不传图片、不调用模型。

账户填写位置：`cam/local/campus-credentials.json`（Git忽略）。username/password仅本地填写，**目前只是待用配置，没有自动登录实现**。确认实际认证端点、协议和安全传输后再接入；不得直接把密码提交给猜测地址或明文门户。此文件不是WIFI_PASSWORD：开放SSID关联无需账户密码，账号属于后续门户认证。

新增独立PlatformIO目标campus-probe，与camera/camera-wifi源文件隔离；只写0x10000应用区，未改bootloader、分区。当前板运行探测应用，重启会再次探测并关闭无线电，不是Wi-Fi相机固件。

备份：历史16MB备份hash已核验；本次完整16MB读回因120秒超时中断，不能当完整备份。随后成功读取当前应用区0x51000字节至`cam/local/pre-campus-app-20261022.bin`。编译探测目标后旧camera构建输出被清理，故与旧构建bin比较未能执行，但写入命令仍执行（PowerShell未因前一命令失败停止）；不应宣称本次读回已与已知应用hash比对。后续先验证读回镜像结构／备份完整性，再进行任何恢复写入。原历史完整备份未覆盖。

随后已用esptool image-info验证本次应用读回：ESP32-S3、DIO／40MHz／16MB，checksum及validation hash均valid；这验证镜像内部完整性，不等于已与历史构建文件逐字匹配。
