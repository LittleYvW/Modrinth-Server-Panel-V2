import { resolve } from 'node:path';
import { createApp } from './app.js';
import { errorCode, isPermissionError } from './errors.js';
import type { ModService } from './mods.js';

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '127.0.0.1';
const dataDirectory = resolve(process.env.DATA_DIR ?? '.panel-data');
// Startup failures are almost always the environment, so say which setting to fix instead of printing a stack.
let app: Awaited<ReturnType<typeof createApp>>;
try {
  app = await createApp({
    dataDirectory,
    staticDirectory: resolve('dist'),
    publicOrigin: process.env.PUBLIC_ORIGIN ? new URL(process.env.PUBLIC_ORIGIN).origin : undefined,
  });
} catch (error) {
  console.error(isPermissionError(error)
    ? `Server Mods 无法启动：没有读写数据目录 ${dataDirectory} 的权限。请检查 DATA_DIR 与运行用户的权限。`
    : `Server Mods 无法启动：${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
const server = app.listen(port, host, () => {
  console.log(`Server Mods: http://${host}:${port}`);
});
server.on('error', error => {
  const code = errorCode(error);
  console.error(code === 'EADDRINUSE' ? `Server Mods 无法启动：端口 ${port} 已被占用，请修改 PORT。`
    : code === 'EACCES' ? `Server Mods 无法启动：没有监听 ${host}:${port} 的权限，请改用 1024 以上的端口或调整系统权限。`
    : `Server Mods 无法启动：${error.message}`);
  process.exit(1);
});
// Watchers, event streams and the scan queue all stop before the process leaves.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.closeAllConnections?.();
    server.close(() => { void (app.locals.mods as ModService).close().then(() => process.exit(0)); });
  });
}
