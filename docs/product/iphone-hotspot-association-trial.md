# iPhone 16热点连接验证（尚未连接成功）

安卓中继已终止；用户选择iPhone16最大兼容性热点，仅提供网络，不装程序。私有SSID/密码在忽略文件cam/local/iphone-hotspot.json，读取时只检查长度，不输出内容，不进入源码、固件或日志。

固件增加WIFI_HOTSPOT_TEST：保存热点profile并把uplink设空，不把iPhone网关当成Android HTTP服务。USB配置`cam/configure_hotspot.py --config cam/local/iphone-hotspot.json --connect-only`收到确认。编译、烧写Hash校验完成；保留原校园凭据、诊断及回退命令。

新增USB NETWORK_LINK_STATUS显示关联状态、IP、网关、RSSI/channel和上传是否配置，无密码；测试30秒仍connected=0、IP/网关0，upload=off。再次目标扫描发现10个AP，目标匹配0；NVS日志持续reason201（NO_AP_FOUND），不是已证实密码错误或硬件故障。不推测iPhone最大兼容性是否真实生效，需核对允许其他人加入、热点页面保持可发现以及SSID准确性。

证据：run/network-diagnostics/iphone-association-1792813454466794100.txt、iphone-scan-1792813491028667600.txt、iphone-history-1792813474713716200.json。未部署公网接收端，未向第三方上传图像或启动模型。单纯关联不等于远程回传验收。
