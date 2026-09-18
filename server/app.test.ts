import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { createApp } from './app.js';
import { HttpError } from './errors.js';
import { hashPassword } from './store.js';
import type { Modrinth } from './modrinth.js';

const root = resolve('.test-data');
const password = 'test-only-password';
const config = { minecraftVersion: '1.20.1', loader: 'quilt', loaderVersion: null };
const sources = { minecraft: async () => ({ versions: [{ id: '1.20.1', type: 'release' }] }), loaders: async () => ({ versions: [{ id: '0.27.1' }] }) };
let directory: string;
let app: Awaited<ReturnType<typeof createApp>>;
let built: Awaited<ReturnType<typeof createApp>>[] = [];
// The mod service must never reach the network from a test, and its watchers must not outlive one.
const offline: Modrinth = { versionsByHash: async () => new Map(), projects: async () => new Map(), project: async () => null };
async function build(options: Omit<Parameters<typeof createApp>[0], 'adminPassword'> & { adminPassword?: string }) {
  const created = await createApp({ modrinth: offline, watchFiles: false, pollInterval: 3_600_000, settleDelay: 0, adminPassword: password, ...options });
  built.push(created);
  return created;
}
function write(agent: ReturnType<typeof request> | ReturnType<typeof request.agent>, path: string, body: unknown, method: 'post' | 'put' = 'post') {
  return agent[method](path).set('Host', 'panel.test').set('Origin', 'http://panel.test').send(body);
}
async function login() {
  const agent = request.agent(app);
  await write(agent, '/api/auth/login', { password }).expect(200);
  return agent;
}
beforeEach(async () => {
  await mkdir(root, { recursive: true });
  directory = await mkdtemp(join(root, 'api-'));
  app = await build({ dataDirectory: join(directory, 'data'), versions: sources });
});
afterEach(async () => {
  for (const created of built) await created.locals.mods.close();
  built = [];
  if (!resolve(directory).startsWith(root + sep)) throw new Error('Unsafe test cleanup');
  await rm(directory, { recursive: true, force: true });
});

describe('administrator authentication', () => {
  it('signs in with the configured password and a private session cookie', async () => {
    expect((await request(app).get('/api/auth/status')).body).toEqual({ authenticated: false, configured: false });
    await write(request(app), '/api/auth/login', { password: 'incorrect' }).expect(401);
    const response = await write(request(app), '/api/auth/login', { password }).expect(200);
    const cookie = response.headers['set-cookie'][0];
    expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('SameSite=Strict');
    expect(response.body).toEqual({ authenticated: true, configured: false });
    expect((await request(app).get('/api/auth/status').set('Cookie', response.headers['set-cookie'])).body.authenticated).toBe(true);
    await request(app).get('/api/admin/config').expect(401);
  });
  it('offers neither registration nor password changes and never stores the password', async () => {
    const agent = await login();
    await write(request(app), '/api/auth/register', { password: 'another-password' }).expect(404);
    await write(agent, '/api/auth/password', { currentPassword: password, newPassword: 'replacement-password' }, 'put').expect(404);
    await write(request(app), '/api/auth/login', { password: 'another-password' }).expect(401);
    await write(agent, '/api/admin/display', { showServerMods: false, showClientMods: true }, 'put').expect(200);
    const stored = await readFile(join(directory, 'data', 'panel.json'), 'utf8');
    expect(stored).not.toContain(password); expect(JSON.parse(stored)).not.toHaveProperty('admin');
  });
  it('refuses to start with an invalid administrator password', async () => {
    await expect(build({ dataDirectory: join(directory, 'weak'), adminPassword: 'short' })).rejects.toThrow('8–256');
  });
  it('rejects cross-origin and missing-origin writes', async () => {
    await request(app).post('/api/auth/login').set('Origin', 'https://other.test').send({ password }).expect(403);
    await request(app).post('/api/auth/login').send({ password }).expect(403);
  });
  it('invalidates sessions on logout and on restart, where a changed password takes effect', async () => {
    const first = await login();
    const second = await login();
    await write(first, '/api/auth/logout', {}).expect(200);
    await first.get('/api/admin/config').expect(401); await second.get('/api/admin/config').expect(200);
    const signedIn = await write(request(app), '/api/auth/login', { password }).expect(200);
    const restarted = await build({ dataDirectory: join(directory, 'data'), versions: sources, adminPassword: 'replacement-password' });
    await request(restarted).get('/api/admin/config').set('Cookie', signedIn.headers['set-cookie']).expect(401);
    await write(request(restarted), '/api/auth/login', { password }).expect(401);
    await write(request(restarted), '/api/auth/login', { password: 'replacement-password' }).expect(200);
  });
  it('drops an administrator hash left by older versions on the next write', async () => {
    const dataDirectory = join(directory, 'legacy');
    await mkdir(dataDirectory);
    await writeFile(join(dataDirectory, 'panel.json'), JSON.stringify({ version: 1, admin: await hashPassword('old-registered-password'), config: null }));
    app = await build({ dataDirectory, versions: sources });
    await write(request(app), '/api/auth/login', { password: 'old-registered-password' }).expect(401);
    const agent = await login();
    await write(agent, '/api/admin/display', { showServerMods: true, showClientMods: false }, 'put').expect(200);
    expect(JSON.parse(await readFile(join(dataDirectory, 'panel.json'), 'utf8'))).toEqual({ version: 1, config: null, display: { showServerMods: true, showClientMods: false } });
  });
  it('expires sessions at 24 hours and rate limits repeated login attempts', async () => {
    let time = 0;
    app = await build({ dataDirectory: join(directory, 'clock'), versions: sources, now: () => time });
    const agent = await login();
    time = 24 * 60 * 60 * 1000 + 1;
    await agent.get('/api/admin/config').expect(401);
    for (let i = 0; i < 10; i++) await write(request(app), '/api/auth/login', { password: 'wrong' }).expect(401);
    const limited = await write(request(app), '/api/auth/login', { password: 'wrong' }).expect(429);
    expect(limited.headers['retry-after']).toBeDefined();
  });
  it('counts only failed attempts and clears them after a successful login', async () => {
    for (let i = 0; i < 20; i++) await write(request(app), '/api/auth/login', { password }).expect(200);
    for (let i = 0; i < 9; i++) await write(request(app), '/api/auth/login', { password: 'wrong' }).expect(401);
    await write(request(app), '/api/auth/login', { password }).expect(200);
    for (let i = 0; i < 10; i++) await write(request(app), '/api/auth/login', { password: 'wrong' }).expect(401);
    await write(request(app), '/api/auth/login', { password }).expect(429);
  });
  it('rate limits each client separately behind a trusted reverse proxy', async () => {
    const proxied = await build({ dataDirectory: join(directory, 'proxied'), publicOrigin: 'http://panel.test' });
    const attempt = (client: string, value: string) => write(request(proxied), '/api/auth/login', { password: value }).set('X-Forwarded-For', client);
    for (let i = 0; i < 10; i++) await attempt('203.0.113.1', 'wrong').expect(401);
    await attempt('203.0.113.1', password).expect(429);
    await attempt('203.0.113.2', password).expect(200);
  });
  it.each([
    ['without a public origin', {}],
    ['from a peer outside the trusted proxies', { publicOrigin: 'http://panel.test', trustProxy: '10.0.0.0/8' }],
  ])('ignores forwarded addresses %s', async (_name, extra) => {
    const direct = await build({ dataDirectory: join(directory, 'direct'), ...extra });
    for (let i = 0; i < 10; i++) await write(request(direct), '/api/auth/login', { password: 'wrong' }).set('X-Forwarded-For', `203.0.113.${i}`).expect(401);
    await write(request(direct), '/api/auth/login', { password }).set('X-Forwarded-For', '203.0.113.99').expect(429);
  });
  it('sets Secure cookies when the public origin is HTTPS', async () => {
    const secure = await build({ dataDirectory: join(directory, 'secure'), publicOrigin: 'https://panel.test' });
    const response = await request(secure).post('/api/auth/login').set('Origin', 'https://panel.test').send({ password }).expect(200);
    expect(response.headers['set-cookie'][0]).toContain('Secure');
  });
});

describe('configuration and directory access', () => {
  it.each(['release', 'snapshot', 'unknown', 'offline', 'slow'] as const)('serves public configuration with optional %s metadata without persisting it', async scenario => {
    const minecraft = async () => {
      if (scenario === 'offline') throw new Error('Upstream unavailable');
      if (scenario === 'slow') return new Promise<{ versions: [] }>(() => {});
      return { versions: scenario === 'unknown' ? [] : [{ id: config.minecraftVersion, type: scenario }] };
    };
    expect((await request(app).get('/api/public/config').expect(200)).body).toBeNull();
    const dataDirectory = join(directory, 'metadata');
    const modsDirectory = join(directory, 'mods');
    await mkdir(dataDirectory);
    await mkdir(modsDirectory);
    // Seed an existing installation: this read-only endpoint should never rewrite its configuration.
    const stored = JSON.stringify({ version: 1, admin: await hashPassword(password), config: { ...config, modsDirectory } });
    await writeFile(join(dataDirectory, 'panel.json'), stored);
    app = await build({ dataDirectory, versions: { ...sources, minecraft } });
    const response = await request(app).get('/api/public/config').expect(200);
    expect(response.body).toEqual({ ...config, minecraftVersionType: scenario === 'release' || scenario === 'snapshot' ? scenario : null });
    expect(await readFile(join(dataDirectory, 'panel.json'), 'utf8')).toBe(stored);
  });
  it('does not invalidate the latest directory check when an older request finishes later', async () => {
    const older = join(directory, 'older'); const latest = join(directory, 'latest');
    let finishOlder!: () => void;
    let startedOlder!: () => void;
    const started = new Promise<void>(resolve => { startedOlder = resolve; });
    app = await build({ dataDirectory: join(directory, 'race'), listDirectory: async value => {
      if (value === older) { startedOlder(); await new Promise<void>(resolve => { finishOlder = resolve; }); }
      return { path: String(value), entries: [], writable: true };
    } });
    const agent = await login();
    const slow = write(agent, '/api/admin/directory/check', { path: older }).then(result => result);
    await started;
    await write(agent, '/api/admin/directory/check', { path: latest }).expect(200);
    finishOlder(); await slow;
    await write(agent, '/api/admin/config', { ...config, modsDirectory: latest }, 'put').expect(200);
  });
  it('lists files without recursion, confirms before saving, and persists only a complete configuration', async () => {
    const agent = await login();
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
    expect((await request(app).get('/api/public/config')).body).toEqual({ ...config, minecraftVersionType: 'release' });
    const restarted = await build({ dataDirectory: join(directory, 'data'), versions: sources });
    const reconnected = request.agent(restarted);
    await write(reconnected, '/api/auth/login', { password }).expect(200);
    expect((await reconnected.get('/api/admin/config')).body).toEqual({ ...config, modsDirectory });
    expect((await reconnected.get('/api/admin/versions/minecraft')).body.versions).toHaveLength(1);
  });
  it('handles empty, nonexistent, relative, file and inaccessible paths', async () => {
    const agent = await login();
    const empty = join(directory, 'empty'); await mkdir(empty);
    expect((await write(agent, '/api/admin/directory/check', { path: empty }).expect(200)).body.entries).toEqual([]);
    await write(agent, '/api/admin/directory/check', { path: join(directory, 'missing') }).expect(400);
    await write(agent, '/api/admin/directory/check', { path: 'relative' }).expect(400);
    const file = join(directory, 'file.jar'); await writeFile(file, 'test');
    expect((await write(agent, '/api/admin/directory/check', { path: file }).expect(400)).body.error).toContain('不是目录');
    const denied = await build({ dataDirectory: join(directory, 'data'), listDirectory: async () => { throw new HttpError(403, '没有读取此目录的权限。'); } });
    const deniedAgent = request.agent(denied); await write(deniedAgent, '/api/auth/login', { password }).expect(200);
    await write(deniedAgent, '/api/admin/directory/check', { path: empty }).expect(403);
  });
  it('rechecks at save time and leaves setup incomplete when a checked directory disappears', async () => {
    const agent = await login();
    const target = join(directory, 'removed'); await mkdir(target);
    await write(agent, '/api/admin/directory/check', { path: target }).expect(200);
    await rmdir(target);
    await write(agent, '/api/admin/config', { ...config, modsDirectory: target }, 'put').expect(400);
    expect((await agent.get('/api/auth/status')).body.configured).toBe(false);
    expect((await request(app).get('/api/public/config')).body).toBe(null);
  });
});

describe('mod list, switches and downloads', () => {
  const hash = (value: string) => createHash('sha512').update(value).digest('hex');
  async function configured() {
    const modsDirectory = join(directory, 'live');
    await mkdir(modsDirectory, { recursive: true });
    await writeFile(join(modsDirectory, 'sodium.jar'), 'sodium');
    await writeFile(join(modsDirectory, 'plain.jar'), 'plain');
    const bound = {
      id: 'v1', project_id: 'p1', version_number: '0.5.3',
      files: [{ hashes: { sha512: hash('sodium') }, url: 'https://cdn.modrinth.com/v1.jar', primary: true }],
      environment: 'client_only',
    };
    const modrinth: Modrinth = {
      versionsByHash: async hashes => new Map(hashes.includes(hash('sodium')) ? [[hash('sodium'), bound]] : []),
      projects: async ids => new Map(ids.includes('p1') ? [['p1', { id: 'p1', slug: 'sodium', title: 'Sodium', description: '现代渲染引擎。', icon_url: 'https://cdn.modrinth.com/p1.png', project_type: 'mod' }]] : []),
      project: async () => null,
    };
    app = await build({ dataDirectory: join(directory, 'data'), versions: sources, modrinth });
    const agent = await login();
    await write(agent, '/api/admin/directory/check', { path: modsDirectory }).expect(200);
    await write(agent, '/api/admin/config', { ...config, modsDirectory }, 'put').expect(200);
    return { agent, modsDirectory };
  }

  it('publishes only open mods, keeps administration private and refuses unauthenticated writes', async () => {
    const { agent, modsDirectory } = await configured();
    const list = (await agent.get('/api/admin/mods').expect(200)).body;
    expect(list.mods.map((mod: { name: string; side: string; binding: string }) => [mod.name, mod.side, mod.binding]))
      .toEqual([['plain', 'both', 'unbound'], ['Sodium', 'client', 'bound']]);
    const sodium = list.mods.find((mod: { name: string }) => mod.name === 'Sodium');
    const publicList = (await request(app).get('/api/public/mods').expect(200)).body;
    expect(publicList.mods).toHaveLength(2);
    expect(JSON.stringify(publicList)).not.toContain(modsDirectory);
    expect(Object.keys(publicList.mods[0])).toEqual(['id', 'name', 'description', 'version', 'iconUrl', 'projectUrl', 'side']);
    await request(app).get('/api/admin/mods').expect(401);
    await request(app).patch(`/api/admin/mods/${sodium.id}`).set('Host', 'panel.test').set('Origin', 'http://panel.test').send({ enabled: false }).expect(401);
    await agent.patch(`/api/admin/mods/${sodium.id}`).set('Origin', 'https://evil.test').send({ enabled: false }).expect(403);
  });

  it('closes a mod, then refuses the old download link until it is opened again', async () => {
    const { agent } = await configured();
    const list = (await agent.get('/api/admin/mods')).body.mods;
    const sodium = list.find((mod: { name: string }) => mod.name === 'Sodium');
    const plain = list.find((mod: { name: string }) => mod.name === 'plain');
    expect((await request(app).get(`/api/public/mods/${sodium.id}/download`).expect(302)).headers.location).toBe('https://cdn.modrinth.com/v1.jar');
    const file = await request(app).get(`/api/public/mods/${plain.id}/download`).expect(200);
    expect(file.headers['content-disposition']).toContain('plain.jar');
    expect(file.text).toBe('plain');
    await write(agent, `/api/admin/mods/${plain.id}`, { enabled: false }, 'patch').expect(200);
    await request(app).get(`/api/public/mods/${plain.id}/download`).expect(404);
    expect((await request(app).get('/api/public/mods')).body.mods).toHaveLength(1);
    await write(agent, `/api/admin/mods/${plain.id}`, { enabled: true }, 'patch').expect(200);
    await request(app).get(`/api/public/mods/${plain.id}/download`).expect(200);
    await request(app).get('/api/public/mods/not-an-entry/download').expect(404);
  });

  it('keeps a manual category and a manual configuration apart from the binding', async () => {
    const { agent } = await configured();
    const list = (await agent.get('/api/admin/mods')).body.mods;
    const sodium = list.find((mod: { name: string }) => mod.name === 'Sodium');
    await write(agent, `/api/admin/mods/${sodium.id}`, { projectId: 'other' }, 'patch').expect(409);
    const unbound = (await write(agent, `/api/admin/mods/${sodium.id}/unbind`, {})).body;
    expect(unbound).toMatchObject({ binding: 'unbound', side: 'client', enabled: true, name: 'Sodium' });
    await write(agent, `/api/admin/mods/${sodium.id}`, { downloadUrl: 'https://mirror.test/sodium.jar' }, 'patch').expect(200);
    expect((await request(app).get(`/api/public/mods/${sodium.id}/download`).expect(302)).headers.location).toBe('https://mirror.test/sodium.jar');
    const manual = (await write(agent, `/api/admin/mods/${sodium.id}`, { side: 'server' }, 'patch')).body;
    expect(manual).toMatchObject({ side: 'server', categorySource: 'manual', downloadUrl: 'https://mirror.test/sodium.jar' });
    const rebound = (await write(agent, `/api/admin/mods/${sodium.id}/resolve`, {})).body;
    expect(rebound).toMatchObject({ binding: 'bound', side: 'server', enabled: true });
  });

  it('hides server and client categories from the public page independently and remembers the choice', async () => {
    const { agent } = await configured();
    const sodium = (await agent.get('/api/admin/mods')).body.mods.find((mod: { name: string }) => mod.name === 'Sodium');
    expect((await agent.get('/api/admin/display').expect(200)).body).toEqual({ showServerMods: true, showClientMods: true });
    expect((await request(app).get('/api/public/mods')).body.sides).toEqual(['both', 'server', 'client']);
    await write(agent, '/api/admin/display', { showServerMods: true }, 'put').expect(400);
    await request(app).put('/api/admin/display').set('Host', 'panel.test').set('Origin', 'http://panel.test').send({ showServerMods: true, showClientMods: false }).expect(401);
    await write(agent, '/api/admin/display', { showServerMods: true, showClientMods: false }, 'put').expect(200);
    const hidden = (await request(app).get('/api/public/mods')).body;
    expect(hidden.sides).toEqual(['both', 'server']);
    expect(hidden.mods.map((mod: { name: string }) => mod.name)).toEqual(['plain']);
    await request(app).get(`/api/public/mods/${sodium.id}/download`).expect(404);
    expect((await agent.get('/api/admin/mods')).body.mods).toHaveLength(2);
    const restarted = await build({ dataDirectory: join(directory, 'data'), versions: sources });
    expect((await request(restarted).get('/api/public/mods')).body.sides).toEqual(['both', 'server']);
    await write(agent, '/api/admin/display', { showServerMods: false, showClientMods: true }, 'put').expect(200);
    expect((await request(app).get('/api/public/mods')).body.sides).toEqual(['both', 'client']);
    await request(app).get(`/api/public/mods/${sodium.id}/download`).expect(302);
  });

  it('streams the list revision to every connected client', async () => {
    const { agent } = await configured();
    const server = app.listen(0);
    try {
      const { port } = server.address() as { port: number };
      const stream = await fetch(`http://127.0.0.1:${port}/api/public/mods/events`);
      const reader = stream.body!.getReader();
      const read = async () => new TextDecoder().decode((await reader.read()).value);
      expect(await read()).toContain('event: mods');
      const plain = (await agent.get('/api/admin/mods')).body.mods.find((mod: { name: string }) => mod.name === 'plain');
      await write(agent, `/api/admin/mods/${plain.id}`, { enabled: false }, 'patch').expect(200);
      expect(await read()).toMatch(/event: mods\ndata: \d+/);
      await reader.cancel();
    } finally {
      server.closeAllConnections();
      await new Promise(done => server.close(done));
    }
  });
});
