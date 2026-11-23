import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDemoServer } from './server.js';

async function runCli(): Promise<void> {
  const args = process.argv.slice(2);
  const portIdx = args.indexOf('--port');
  const portArg = portIdx >= 0 ? Number(args[portIdx + 1]) : undefined;
  if (portArg !== undefined && (!Number.isInteger(portArg) || portArg < 1 || portArg > 65535)) {
    throw new Error('Invalid --port value');
  }
  const hostIdx = args.indexOf('--host');
  const hostArg = hostIdx >= 0 ? args[hostIdx + 1] : undefined;
  const noCameras = args.includes('--no-cameras');
  const enableTunnel = args.includes('--tunnel');

  const demo = await createDemoServer({
    ...(portArg !== undefined ? { port: portArg } : {}),
    ...(hostArg ? { host: hostArg } : {}),
    enableTunnel,
    hubOptions: {
      startCameraProcess: !noCameras,
    },
  });

  const urls = demo.getConnectionUrls();
  process.stdout.write('\n=============================================\n');
  process.stdout.write(' First Sight 课内演示系统已启动\n');
  process.stdout.write(` 电脑主控台 (本机): http://127.0.0.1:${demo.port}/\n`);
  process.stdout.write(` 历史会话回放页:    http://127.0.0.1:${demo.port}/replay.html\n`);
  process.stdout.write(` 手机扫码入口 (LAN): ${urls[0]!.url}\n`);
  process.stdout.write(` 配对码 (Token):    ${demo.token}\n`);
  if (enableTunnel) {
    process.stdout.write(' 正在后台启动 Cloudflare HTTPS 隧道，就绪后二维码将自动切换...\n');
  }
  if (!process.env.QWEN_API_KEY || !process.env.QWEN_BASE_URL) {
    process.stdout.write(' [提示] 未检测到 QWEN_API_KEY / QWEN_BASE_URL，问答/关注功能将提示未配置；预览/IP定位/语音测试/回放可正常使用。\n');
  }
  process.stdout.write(' 按 Ctrl+C 停止服务。\n');
  process.stdout.write('=============================================\n\n');

  const shutdown = () => {
    void demo.close().finally(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  void runCli().catch((err) => {
    process.stderr.write(`First Sight demo failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
