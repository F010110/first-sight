# Android热点中继：最小连接验证版

用户确认Redmi备用机可同时连BUPT-mobile和开WLAN热点，无SIM。此为手动确认，不是本项目已完成ESP32→手机→电脑实机验收。

## 架构

ESP32连接手机2.4GHz热点、JPEG POST到手机热点网关8885；原生Android前台服务接收，另一个线程通过手机默认网络向电脑校园IP:8885转发。电脑保持原校园网，不连手机热点。热点并发不保证跨接口转发或锁屏存活，均需实测。不要求Root、不安装CA、不使用旧手机相机试用接口。

连接验证APK使用系统原生Java API，无第三方库。Android最低8.0，目标API34；前台connectedDevice服务、持续通知和唤醒锁，用户仍需允许通知、将电池策略设为不限制。唤醒锁有耗电影响，不能保证HyperOS不会终止应用。停止按钮显式结束服务，重启手机后不自动恢复。

## 隐私与边界

本版**仅验证预览中继**，图像只在RAM保留一个待转发最新帧和一个正在转发帧，不写手机存储。手机HTTP200仅表示RAM接受，不表示电脑已保存；UI分别显示手机收到和电脑确认数量。传不出或过时的帧会丢弃，不提供录制可靠补传承诺。本版不改变PC记录开关；记录开启时仍只有电脑实际收到的图才存档。

手机保存不含图像／凭据的诊断元数据，约256KB轮转，保留当前与上一文件；可通过系统文件选择器导出。转发保留原boot、sequence、hash等头；手机接收与电脑响应事件可按序号对齐。手机接收验证鉴权、长度、SHA256与640×480尺寸，拒绝其他HTTP路由，不暴露控制模型接口。HTTP明文仅作局域网实验，不当TLS。

配置通过本地私有JSON导入：`python scripts/prepare-android-relay-config.py --computer-host 当前电脑IP`。输出到已忽略的cam/local/android-relay-config.json，含配对密钥；不进源码／APK／聊天，不能公开发布。手机配置存在应用私有偏好，禁止系统备份；导入后应从共享下载目录移除密钥配置文件。无需模型API密钥。

## 构建与安装

SDK Android35平台和build-tools35.0.0、JDK17，脚本：`scripts/build-android-relay.ps1 -Sdk 本地SDK路径 -JavaHome 本地JDK路径`。APK生成到忽略目录run/android-relay-build/first-sight-relay-debug.apk，私有调试签名在工具临时目录，不入仓库。

手机安装需用户批准安装来源；MTP仅能传输文件，不能绕过安装授权。或USB调试授权后adb安装。电脑不能仅因手机支持文件传输就自动控制其系统。

## 验证顺序

1. 安装导入配置，保持BUPT-mobile及热点，手机点启动，确认8885监听；从第二设备探测鉴权接收，不动摄像头原配置。
2. 确认手机到电脑接收端可达，校园WLAN终端互访若被隔离则需另选路径。
3. 再为摄像头加入可回退的热点Wi-Fi配置及手机网关上传地址，不能使用当前写死校园SSID／10.122地址约束直接冒充可用。
4. 桌边至少连续预览、手机锁屏、短暂上行断网及恢复测试；分别核对phone-received和computer-response、PC实帧。未通过前不请用户实走。
5. 如需要录制可靠缓存，下一阶段单独设计手机端记录授权、持久队列、ACK、补传历史标识和容量，不在默认预览偷偷缓存图像。

旧docs/application/mobile-trial.md的HTTPS CA只让浏览器访问电脑安全页面，并不赋予浏览器后台HTTP监听能力；不能作为可靠中继替代原生服务。

## 当前构建结果

已用官方SDK Android35平台／Build Tools35.0.0及JDK17实际编译并完成APK v2/v3签名验证；aapt确认包名org.firstsight.relay、最低API26、目标34。APK约21KB，不含设备配对密钥（逐ZIP条目扫描确认）。启动服务先发送明确标识android-relay-probe的无图像诊断探针，便于摄像头尚未切换前验证手机→电脑方向。

目前ADB列表为空、未识别到MTP手机，尚未传输／安装APK，也未完成手机端运行、热点／上行路由、锁屏验收。旧命令行工具下载过慢，最终直接下载并按官方repository2-1.xml SHA1校验平台和Build Tools归档，手动脚本构建，无Gradle依赖。

## 后续接线进度

APK及私有配置已通过MTP送到手机Download，复查大小20823／114字节；用户安装启动。电脑后来IP变为10.21.167.88且原服务已停止，现以新IP恢复push服务，手机需停止后更新目的地址再启动。未收到新手机探针前不声称手机到电脑已通。

摄像头COM3已接回，新固件已编译烧写Hash验证：支持独立NVS热点profile，默认仍用原BUPT-portal，热点模式跳过校园Portal登录；热点模式上传到DHCP网关8885，省去猜手机IP。仅USB命令WIFI_HOTSPOT接收hex编码的SSID/password，不打印，不嵌入固件。摄像头原校园凭据与持久诊断仍保留。网络目的地址约束扩展到RFC1918私有IPv4，仍限HTTP8885/v1/upload，无任意公网转发。

本地cam/local/android-hotspot.json（git忽略）由用户填ssid/password，手机热点设2.4GHz、WPA2；然后执行`cam/.venv/Scripts/python.exe cam/configure_hotspot.py`。当前只创建空模板并打开本地记事本，**还未获取热点凭据／实际切换**。写入NVS后重启，必须核对手机接收和电脑确认两个计数。回退命令`cam/.venv/Scripts/python.exe cam/configure_hotspot.py --restore-campus-host 10.21.167.88`（电脑地址变动需替换），先设电脑目的地址再切回校园profile，不删除原始证据。
