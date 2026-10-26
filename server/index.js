/**
 * 进程入口：监听本机端口，优雅退出。
 *
 * 兼容说明：Node 22 的 `node --test <目录>` 会把目录按模块解析成该目录下的
 * index.js，而不会递归发现测试文件（package.json 的 test 脚本固定为
 * `node --test server`）。因此在测试子进程里改为加载 server 下全部测试文件，
 * 让该命令真正执行整套后端测试；正常运行（无 NODE_TEST_CONTEXT）时行为不变。
 */
import http from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './config.js';

if (process.env.NODE_TEST_CONTEXT) {
  await import('./testing/runAllTests.js');
} else {
  const config = loadConfig();
  const app = await createApp({ config });
  const server = http.createServer(app.handler);

  server.on('error', (err) => {
    console.error(`[server] 启动失败：${err.message}`);
    process.exit(1);
  });

  server.listen(config.port, config.host, () => {
    console.log(`Prompt Atelier 后端已启动：http://${config.host}:${config.port}`);
    console.log(`数据目录：${config.dataDir}`);
  });

  let closing = false;
  function shutdown(signal) {
    if (closing) return;
    closing = true;
    console.log(`\n[server] 收到 ${signal}，正在关闭…`);
    server.close(() => process.exit(0));
    // 兜底：连接迟迟不断开时强制退出
    setTimeout(() => process.exit(0), 3000).unref();
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
