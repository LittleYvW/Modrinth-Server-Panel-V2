import { resolve } from 'node:path';
import { createApp } from './app.js';
import type { ModService } from './mods.js';

const port = Number(process.env.PORT ?? 3001);
const app = await createApp({
  dataDirectory: resolve(process.env.DATA_DIR ?? '.panel-data'),
  staticDirectory: resolve('dist'),
  publicOrigin: process.env.PUBLIC_ORIGIN ? new URL(process.env.PUBLIC_ORIGIN).origin : undefined,
});
const server = app.listen(port, process.env.HOST ?? '127.0.0.1', () => {
  console.log(`Server Mods: http://${process.env.HOST ?? '127.0.0.1'}:${port}`);
});
// Watchers, event streams and the scan queue all stop before the process leaves.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.closeAllConnections?.();
    server.close(() => { void (app.locals.mods as ModService).close().then(() => process.exit(0)); });
  });
}
