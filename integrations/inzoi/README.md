# First-Sight inZOI接口探针

**状态：文档确认＋可注入的CLI调用模块；尚未安装游戏、未部署UI Mod、未产生真实截图，不是三摄实现。**

入口`probe-capabilities.mjs`接受真实官方UI Mod宿主的CLI binding：

```javascript
import {probeCapabilities} from './probe-capabilities.mjs';
const result = await probeCapabilities(window.inzoi.cli.execute.bind(window.inzoi.cli));
// 显式允许一次截图请求；不覆盖已有文件：
const captureResult = await probeCapabilities(window.inzoi.cli.execute.bind(window.inzoi.cli), {capture: true});
```

此代码需集成到游戏当前版本支持的UI Mod工程中，**不能直接在普通浏览器或Node下连接游戏**；本轮未编造ModKit manifest/装载方式。用户安装游戏后先核实其构建版本和官方UI Mod入口，再部署该模块。默认只读取`camera.get_view`；capture模式最多请求一张图并读取一次异步状态。原样保留返回envelope，不猜测对象结构，不因Promise resolved宣称命令成功。

官方文档明确：

- Lua主要运行B2线程，`AB1SceneCapture2D`属于B1；其回调返回材质，不是已确认的RGB字节。
- `camera.get_view`是Public/B1Standalone/Experimental，返回当前渲染相机cache、基向量、FOV、分辨率；UE左手系，XYZ厘米，+X前/+Y右/+Z上。
- `screenshot.capture`同为Public/B1Standalone/Experimental；show_ui=false只截3D场景，unique_suffix=true防覆盖。返回时文件尚不存在，下个呈现帧才写入；需`screenshot.get_last`确认saved=true，再读取真实文件。
- 单个截图状态及前后相机快照并不保证曝光时刻与pose精确对应；同时只允许一个全引擎待处理截图。若Photo Mode占用捕获委托可能失败。

尚未确认普通Mod创建三SceneCapture、读RenderTarget像素、跨B1/B2安全调用、任意设置相机朝向、暂停后切换可见、严格同状态三摄。**不靠UE5通用API伪造实现，不用桌面连截图替代核心验收。**

官方来源及hash：`run/game-generator-selection-v2/`。商业游戏/ModKit/角色与场景资产的科研使用、图像发布许可尚需核实。尚未安装大型ModKit，也不使用游戏内生成式AI工具或付费模型。
