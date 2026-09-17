import express, { type Request, type Response, type NextFunction } from 'express';
import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import { loaders, type Loader, type PanelConfig } from '../shared/types.js';
import { createStore, hashPassword, validatePassword, verifyPassword } from './store.js';
import { directoryPath, readDirectory } from './directory.js';
import { createVersionService } from './versions.js';
import { createModService } from './mods.js';
import type { Modrinth } from './modrinth.js';
import { HttpError } from './errors.js';

type Options = {
  dataDirectory: string;
  publicOrigin?: string;
  staticDirectory?: string;
  versions?: ReturnType<typeof createVersionService>;
  listDirectory?: typeof readDirectory;
  now?: () => number;
  modrinth?: Modrinth;
  watchFiles?: boolean;
  pollInterval?: number;
  settleDelay?: number;
};
type Session = { expires: number; adminHash: string; checkedDirectories: Set<string> };
const COOKIE = 'server_mods_session';
const SESSION_AGE = 24 * 60 * 60 * 1000;
const ATTEMPT_LIMIT = 10;
const ATTEMPT_WINDOW = 15 * 60 * 1000;

export async function createApp(options: Options) {
  const store = await createStore(options.dataDirectory);
  const versions = options.versions ?? createVersionService();
  const mods = await createModService({
    dataDirectory: options.dataDirectory, modrinth: options.modrinth,
    watchFiles: options.watchFiles, pollInterval: options.pollInterval, settleDelay: options.settleDelay,
  });
  const listDirectory = options.listDirectory ?? readDirectory;
  const now = options.now ?? Date.now;
  const sessions = new Map<string, Session>();
  const attempts = new Map<string, { count: number; until: number }>();
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use('/api', (req, _res, next) => {
    for (const [key, value] of sessions) if (value.expires <= now()) sessions.delete(key);
    for (const [key, value] of attempts) if (value.until <= now()) attempts.delete(key);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const expected = options.publicOrigin ?? `${req.protocol}://${req.get('host')}`;
      if (req.get('origin') !== expected || req.get('sec-fetch-site') === 'cross-site') {
        throw new HttpError(403, '请求来源不受信任，请从面板页面重试。');
      }
      if (!req.is('application/json')) throw new HttpError(415, '请求须使用 JSON 格式。');
    }
    next();
  });
  app.use(express.json({ limit: '16kb' }));
  function token(req: Request) {
    return req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  }
  function session(req: Request) {
    const key = token(req);
    const value = key ? sessions.get(key) : undefined;
    return value?.adminHash === store.read().admin?.hash ? value : undefined;
  }
  function requireSession(req: Request, _res?: Response, next?: NextFunction) {
    const value = session(req);
    if (!value || value.expires <= now()) throw new HttpError(401, '登录已失效，请重新登录。');
    next?.();
    return value;
  }
  function cookieOptions(req: Request) {
    return { httpOnly: true, sameSite: 'strict' as const, secure: req.secure || options.publicOrigin?.startsWith('https://') === true, path: '/' };
  }
  function issueSession(req: Request, res: Response) {
    const previous = token(req);
    if (previous) sessions.delete(previous);
    const key = randomBytes(32).toString('hex');
    sessions.set(key, { expires: now() + SESSION_AGE, adminHash: store.read().admin!.hash, checkedDirectories: new Set() });
    res.cookie(COOKIE, key, { ...cookieOptions(req), maxAge: SESSION_AGE });
  }
  function throttle(req: Request, res: Response, next: NextFunction) {
    const attempt = attempts.get(req.ip ?? 'unknown');
    if (attempt && attempt.count >= ATTEMPT_LIMIT && attempt.until > now()) {
      res.set('Retry-After', String(Math.ceil((attempt.until - now()) / 1000)));
      throw new HttpError(429, '尝试次数过多，请稍后再试。');
    }
    next();
  }
  function recordFailure(req: Request) {
    const key = req.ip ?? 'unknown';
    const attempt = attempts.get(key) ?? { count: 0, until: now() + ATTEMPT_WINDOW };
    attempt.count += 1;
    attempts.set(key, attempt);
  }
  function clearFailures(req: Request) {
    attempts.delete(req.ip ?? 'unknown');
  }
  function status(req: Request) {
    const state = store.read();
    return { registered: !!state.admin, authenticated: !!session(req), configured: !!state.config };
  }
  app.get('/api/auth/status', (req, res) => res.json(status(req)));
  app.post('/api/auth/register', throttle, async (req, res) => {
    const password: unknown = req.body?.password;
    validatePassword(password);
    await store.update(async state => {
      if (state.admin) { recordFailure(req); throw new HttpError(409, '管理员密码已创建，请登录。'); }
      return { ...state, admin: await hashPassword(password) };
    });
    clearFailures(req);
    issueSession(req, res);
    res.status(201).json({ ...status(req), authenticated: true });
  });
  app.post('/api/auth/login', throttle, async (req, res) => {
    const admin = store.read().admin;
    if (!admin) throw new HttpError(409, '请先注册管理员密码。');
    if (!await verifyPassword(req.body?.password, admin) || store.read().admin !== admin) {
      recordFailure(req);
      throw new HttpError(401, '密码不正确，请重试。');
    }
    clearFailures(req);
    issueSession(req, res);
    res.json({ ...status(req), authenticated: true });
  });
  app.post('/api/auth/logout', requireSession, (req, res) => {
    sessions.delete(token(req)!);
    res.clearCookie(COOKIE, cookieOptions(req));
    res.json({ ok: true });
  });
  app.put('/api/auth/password', requireSession, throttle, async (req, res) => {
    const password: unknown = req.body?.newPassword;
    validatePassword(password);
    await store.update(async state => {
      requireSession(req);
      if (!state.admin || !await verifyPassword(req.body?.currentPassword, state.admin)) {
        recordFailure(req);
        throw new HttpError(400, '当前密码不正确。');
      }
      const admin = await hashPassword(password);
      requireSession(req);
      return { ...state, admin };
    });
    clearFailures(req);
    sessions.clear();
    res.clearCookie(COOKIE, cookieOptions(req));
    res.json({ ok: true });
  });
  app.get('/api/public/mods', (_req, res) => res.json(mods.publicList()));
  // One revision stream serves both views; a client refetches the list it is showing.
  app.get('/api/public/mods/events', (_req, res) => {
    res.set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders?.();
    const send = (value: number) => { res.write(`event: mods\ndata: ${value}\n\n`); };
    send(mods.publicList().revision);
    const unsubscribe = mods.subscribe(send);
    const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 25000);
    keepAlive.unref?.();
    const stop = () => { clearInterval(keepAlive); unsubscribe(); };
    res.on('close', stop); res.on('error', stop);
  });
  app.get('/api/public/mods/:id/download', async (req, res) => {
    const result = await mods.download(req.params.id);
    if (result.redirect) { res.redirect(302, result.redirect); return; }
    res.set({ 'Content-Type': 'application/java-archive', 'Content-Length': String(result.size), 'Content-Disposition': attachment(result.fileName!) });
    const file = createReadStream(result.path!);
    file.on('error', () => { res.destroy(); });
    res.on('close', () => file.destroy());
    file.pipe(res);
  });
  app.get('/api/public/config', (_req, res) => {
    const config = store.read().config;
    res.json(config ? { minecraftVersion: config.minecraftVersion, loader: config.loader, loaderVersion: config.loaderVersion } : null);
  });
  app.use('/api/admin', requireSession);
  app.post('/api/admin/directory/check', async (req, res) => {
    const result = await listDirectory(req.body?.path);
    const checked = requireSession(req).checkedDirectories;
    checked.add(result.path);
    if (checked.size > 32) checked.delete(checked.values().next().value!);
    res.json(result);
  });
  app.get('/api/admin/config', (_req, res) => res.json(store.read().config));
  app.put('/api/admin/config', async (req, res) => {
    const body = req.body;
    const modsDirectory = directoryPath(body?.modsDirectory);
    const minecraftVersion = versionInput(body?.minecraftVersion);
    if (!loaders.includes(body?.loader)) throw new HttpError(400, '请选择有效的模组加载器。');
    const loaderVersion = body?.loaderVersion === null || body?.loaderVersion === '' ? null : versionInput(body?.loaderVersion);
    const config: PanelConfig = { modsDirectory, minecraftVersion, loader: body.loader, loaderVersion };
    await store.update(async state => {
      const current = requireSession(req);
      if (state.config?.modsDirectory !== modsDirectory && !current.checkedDirectories.has(modsDirectory)) throw new HttpError(400, '请先检查并确认模组目录。');
      await listDirectory(modsDirectory);
      requireSession(req);
      return { ...state, config };
    });
    await mods.use(modsDirectory);
    res.json(config);
  });
  app.get('/api/admin/mods', (_req, res) => res.json(mods.adminList()));
  app.patch('/api/admin/mods/:id', async (req, res) => res.json(await mods.update(req.params.id, req.body ?? {})));
  app.post('/api/admin/mods/:id/unbind', async (req, res) => res.json(await mods.unbind(req.params.id)));
  app.post('/api/admin/mods/:id/resolve', async (req, res) => res.json(await mods.resolve(req.params.id)));
  app.get('/api/admin/versions/minecraft', async (_req, res) => res.json(await versions.minecraft()));
  app.get('/api/admin/versions/loaders', async (req, res) => {
    if (!loaders.includes(req.query.loader as Loader)) throw new HttpError(400, '请选择有效的模组加载器。');
    const game = versionInput(req.query.minecraft);
    res.json(await versions.loaders(req.query.loader as Loader, game));
  });
  app.use('/api', (_req, _res, next) => next(new HttpError(404, '接口不存在。')));
  if (options.staticDirectory) app.use(express.static(resolve(options.staticDirectory), { dotfiles: 'deny' }));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) { res.end(); return; }
    if (error instanceof HttpError) { res.status(error.status).json({ error: error.message }); return; }
    const parserError = error as { type?: string };
    if (parserError.type === 'entity.parse.failed' || parserError.type === 'entity.too.large') {
      res.status(400).json({ error: '请求内容无效或过大。' }); return;
    }
    console.error('Panel request failed:', error instanceof Error ? error.message : 'Unknown error');
    res.status(500).json({ error: '操作失败，请检查服务状态后重试。' });
  });
  await mods.use(store.read().config?.modsDirectory ?? null);
  app.locals.mods = mods;
  return app;
}

// Mod file names may be non-ASCII, so the plain parameter stays safe and the encoded one carries the real name.
function attachment(name: string) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
function versionInput(value: unknown) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._+\-]{0,99}$/.test(value.trim())) {
    throw new HttpError(400, '请输入有效的版本号（字母、数字、点、加号或连字符）。');
  }
  return value.trim();
}
