import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { mkdir, mkdtemp, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { createApp } from './app.js';
import { HttpError } from './errors.js';

const root = resolve('.test-data');
const password = 'test-only-password';
const config = { minecraftVersion: '1.20.1', loader: 'quilt', loaderVersion: null };
const sources = { minecraft: async () => ({ versions: [{ id: '1.20.1', type: 'release' }] }), loaders: async () => ({ versions: [{ id: '0.27.1' }] }) };
let directory: string;
let app: Awaited<ReturnType<typeof createApp>>;
function write(agent: ReturnType<typeof request> | ReturnType<typeof request.agent>, path: string, body: unknown, method: 'post' | 'put' = 'post') {
  return agent[method](path).set('Host', 'panel.test').set('Origin', 'http://panel.test').send(body);
}
async function register() {
  const agent = request.agent(app);
  await write(agent, '/api/auth/register', { password }).expect(201);
  return agent;
}
beforeEach(async () => {
  await mkdir(root, { recursive: true });
  directory = await mkdtemp(join(root, 'api-'));
  app = await createApp({ dataDirectory: join(directory, 'data'), versions: sources });
});
afterEach(async () => {
  if (!resolve(directory).startsWith(root + sep)) throw new Error('Unsafe test cleanup');
  await rm(directory, { recursive: true, force: true });
});

describe('administrator authentication', () => {
  it('registers once with a hashed password and a private session cookie', async () => {
    expect((await request(app).get('/api/auth/status')).body).toEqual({ registered: false, authenticated: false, configured: false });
    await write(request(app), '/api/auth/register', { password: 'short' }).expect(400);
    const response = await write(request(app), '/api/auth/register', { password }).expect(201);
    const cookie = response.headers['set-cookie'][0];
    expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('SameSite=Strict');
    expect(response.body.authenticated).toBe(true);
    const stored = await readFile(join(directory, 'data', 'panel.json'), 'utf8');
    expect(stored).not.toContain(password); expect(JSON.parse(stored).admin.hash).toHaveLength(128);
    await write(request(app), '/api/auth/register', { password }).expect(409);
    await request(app).get('/api/admin/config').expect(401);
    await write(request(app), '/api/auth/login', { password: 'incorrect' }).expect(401);
  });
  it('serializes simultaneous first registrations', async () => {
    const responses = await Promise.all([write(request(app), '/api/auth/register', { password }), write(request(app), '/api/auth/register', { password: 'another-password' })]);
    expect(responses.map(r => r.status).sort()).toEqual([201, 409]);
  });
  it('rejects cross-origin and missing-origin writes', async () => {
    await request(app).post('/api/auth/register').set('Origin', 'https://other.test').send({ password }).expect(403);
    await request(app).post('/api/auth/register').send({ password }).expect(403);
  });
  it('invalidates sessions on logout, password changes and process restart', async () => {
    const first = await register();
    const second = request.agent(app);
    await write(second, '/api/auth/login', { password }).expect(200);
    await write(first, '/api/auth/password', { currentPassword: 'incorrect', newPassword: 'replacement-password' }, 'put').expect(400);
    await write(first, '/api/auth/password', { currentPassword: password, newPassword: 'replacement-password' }, 'put').expect(200);
    await first.get('/api/admin/config').expect(401); await second.get('/api/admin/config').expect(401);
    await write(first, '/api/auth/login', { password }).expect(401);
    const login = await write(first, '/api/auth/login', { password: 'replacement-password' }).expect(200);
    const restarted = await createApp({ dataDirectory: join(directory, 'data'), versions: sources });
    await request(restarted).get('/api/admin/config').set('Cookie', login.headers['set-cookie']).expect(401);
    expect((await request(restarted).get('/api/auth/status')).body.registered).toBe(true);
    await write(first, '/api/auth/logout', {}).expect(200); await first.get('/api/admin/config').expect(401);
  });
  it('expires sessions at 24 hours and rate limits repeated login attempts', async () => {
    let time = 0;
    app = await createApp({ dataDirectory: join(directory, 'clock'), versions: sources, now: () => time });
    const agent = await register();
    time = 24 * 60 * 60 * 1000 + 1;
    await agent.get('/api/admin/config').expect(401);
    for (let i = 0; i < 10; i++) await write(request(app), '/api/auth/login', { password: 'wrong' }).expect(401);
    const limited = await write(request(app), '/api/auth/login', { password: 'wrong' }).expect(429);
    expect(limited.headers['retry-after']).toBeDefined();
  });
  it('counts only failed attempts and clears them after a successful login', async () => {
    await register();
    for (let i = 0; i < 20; i++) await write(request(app), '/api/auth/login', { password }).expect(200);
    for (let i = 0; i < 9; i++) await write(request(app), '/api/auth/login', { password: 'wrong' }).expect(401);
    await write(request(app), '/api/auth/login', { password }).expect(200);
    for (let i = 0; i < 10; i++) await write(request(app), '/api/auth/login', { password: 'wrong' }).expect(401);
    await write(request(app), '/api/auth/login', { password }).expect(429);
  });
  it('sets Secure cookies when the public origin is HTTPS', async () => {
    const secure = await createApp({ dataDirectory: join(directory, 'secure'), publicOrigin: 'https://panel.test' });
    const response = await request(secure).post('/api/auth/register').set('Origin', 'https://panel.test').send({ password }).expect(201);
    expect(response.headers['set-cookie'][0]).toContain('Secure');
  });
});

describe('configuration and directory access', () => {
  it('does not invalidate the latest directory check when an older request finishes later', async () => {
    const older = join(directory, 'older'); const latest = join(directory, 'latest');
    let finishOlder!: () => void;
    let startedOlder!: () => void;
    const started = new Promise<void>(resolve => { startedOlder = resolve; });
    app = await createApp({ dataDirectory: join(directory, 'race'), listDirectory: async value => {
      if (value === older) { startedOlder(); await new Promise<void>(resolve => { finishOlder = resolve; }); }
      return { path: String(value), entries: [] };
    } });
    const agent = await register();
    const slow = write(agent, '/api/admin/directory/check', { path: older }).then(result => result);
    await started;
    await write(agent, '/api/admin/directory/check', { path: latest }).expect(200);
    finishOlder(); await slow;
    await write(agent, '/api/admin/config', { ...config, modsDirectory: latest }, 'put').expect(200);
  });
  it('lists files without recursion, confirms before saving, and persists only a complete configuration', async () => {
    const agent = await register();
    const modsDirectory = join(directory, '中文 模组');
    await mkdir(join(modsDirectory, 'nested'), { recursive: true });
    await writeFile(join(modsDirectory, 'example.jar'), 'private contents');
    await writeFile(join(modsDirectory, 'nested', 'hidden.jar'), 'nested contents');
    await write(agent, '/api/admin/config', { ...config, modsDirectory }, 'put').expect(400);
    const listing = await write(agent, '/api/admin/directory/check', { path: modsDirectory }).expect(200);
    expect(listing.body.entries).toEqual([{ name: 'nested', type: 'directory' }, { name: 'example.jar', type: 'file' }]);
    expect(JSON.stringify(listing.body)).not.toContain('contents');
    expect((await agent.get('/api/auth/status')).body.configured).toBe(false);
    await write(agent, '/api/admin/config', { ...config, modsDirectory, minecraftVersion: '' }, 'put').expect(400);
    await write(agent, '/api/admin/config', { ...config, modsDirectory }, 'put').expect(200);
    expect((await agent.get('/api/auth/status')).body.configured).toBe(true);
    expect((await request(app).get('/api/public/config')).body).toEqual(config);
    const restarted = await createApp({ dataDirectory: join(directory, 'data'), versions: sources });
    const reconnected = request.agent(restarted);
    await write(reconnected, '/api/auth/login', { password }).expect(200);
    expect((await reconnected.get('/api/admin/config')).body).toEqual({ ...config, modsDirectory });
    expect((await reconnected.get('/api/admin/versions/minecraft')).body.versions).toHaveLength(1);
  });
  it('handles empty, nonexistent, relative, file and inaccessible paths', async () => {
    const agent = await register();
    const empty = join(directory, 'empty'); await mkdir(empty);
    expect((await write(agent, '/api/admin/directory/check', { path: empty }).expect(200)).body.entries).toEqual([]);
    await write(agent, '/api/admin/directory/check', { path: join(directory, 'missing') }).expect(400);
    await write(agent, '/api/admin/directory/check', { path: 'relative' }).expect(400);
    const file = join(directory, 'file.jar'); await writeFile(file, 'test');
    expect((await write(agent, '/api/admin/directory/check', { path: file }).expect(400)).body.error).toContain('不是目录');
    const denied = await createApp({ dataDirectory: join(directory, 'data'), listDirectory: async () => { throw new HttpError(403, '没有读取此目录的权限。'); } });
    const deniedAgent = request.agent(denied); await write(deniedAgent, '/api/auth/login', { password }).expect(200);
    await write(deniedAgent, '/api/admin/directory/check', { path: empty }).expect(403);
  });
  it('rechecks at save time and leaves setup incomplete when a checked directory disappears', async () => {
    const agent = await register();
    const target = join(directory, 'removed'); await mkdir(target);
    await write(agent, '/api/admin/directory/check', { path: target }).expect(200);
    await rmdir(target);
    await write(agent, '/api/admin/config', { ...config, modsDirectory: target }, 'put').expect(400);
    expect((await agent.get('/api/auth/status')).body.configured).toBe(false);
    expect((await request(app).get('/api/public/config')).body).toBe(null);
  });
});
