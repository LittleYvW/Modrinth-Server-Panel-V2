import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, utimes, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { createModService, CLIENT_DIRECTORY, type ModService } from './mods.js';
import { classify, legacySide, projectEnvironmentSide, type Modrinth, type ModrinthProject, type ModrinthVersion } from './modrinth.js';

const root = resolve('.test-data');
const sha512 = (value: string) => createHash('sha512').update(value).digest('hex');
let directory: string;
let mods: string;
let service: ModService;

type Fake = {
  versions?: Record<string, ModrinthVersion>;
  projects?: Record<string, ModrinthProject>;
  failVersions?: () => Error | null;
  failProjects?: () => Error | null;
  calls?: { versions: number; projects: number };
};
function fakeModrinth(data: Fake): Modrinth {
  data.calls = { versions: 0, projects: 0 };
  return {
    async versionsByHash(hashes) {
      data.calls!.versions++;
      const failure = data.failVersions?.();
      if (failure) throw failure;
      const found = new Map<string, ModrinthVersion>();
      for (const hash of hashes) { const version = data.versions?.[hash]; if (version) found.set(hash.toLowerCase(), version); }
      return found;
    },
    async projects(ids) {
      data.calls!.projects++;
      const failure = data.failProjects?.();
      if (failure) throw failure;
      const found = new Map<string, ModrinthProject>();
      for (const id of ids) { const project = data.projects?.[id]; if (project) found.set(id, project); }
      return found;
    },
    async project(idOrSlug) {
      const failure = data.failProjects?.();
      if (failure) throw failure;
      return Object.values(data.projects ?? {}).find(entry => entry.id === idOrSlug || entry.slug === idOrSlug) ?? null;
    },
  };
}
function version(id: string, projectId: string, hash: string, extra: Partial<ModrinthVersion> = {}): ModrinthVersion {
  return { id, project_id: projectId, version_number: '1.2.3', files: [{ hashes: { sha512: hash }, url: `https://cdn.modrinth.com/${id}.jar`, primary: true }], ...extra };
}
function project(id: string, extra: Partial<ModrinthProject> = {}): ModrinthProject {
  return { id, slug: id, title: `Project ${id}`, description: 'A test project.', icon_url: `https://cdn.modrinth.com/${id}.png`, project_type: 'mod', ...extra };
}
async function start(data: Fake = {}, options: { dataDirectory?: string } = {}) {
  service = await createModService({
    dataDirectory: options.dataDirectory ?? join(directory, 'data'),
    modrinth: fakeModrinth(data), watchFiles: false, pollInterval: 3_600_000, settleDelay: 0,
  });
  await service.use(mods);
  return service;
}
const admin = (id?: string) => id ? service.adminList().mods.find(mod => mod.id === id)! : service.adminList().mods;
const names = async (location = '.') => (await readdir(join(mods, location)).catch(() => [])).sort();

beforeEach(async () => {
  await mkdir(root, { recursive: true });
  directory = await mkdtemp(join(root, 'mods-'));
  mods = join(directory, 'mods');
  await mkdir(mods, { recursive: true });
  await mkdir(join(directory, 'data'), { recursive: true });
});
afterEach(async () => {
  await service?.close();
  if (!resolve(directory).startsWith(root + sep)) throw new Error('Unsafe test cleanup');
  await rm(directory, { recursive: true, force: true });
});

describe('side classification', () => {
  it.each([
    ['client_only', 'client'], ['client_only_server_optional', 'client'], ['singleplayer_only', 'client'],
    ['server_only', 'server'], ['server_only_client_optional', 'server'], ['dedicated_server_only', 'server'],
    ['client_and_server', 'both'], ['client_or_server', 'both'], ['client_or_server_prefers_both', 'both'],
  ])('reads the version environment %s as %s', (environment, side) => {
    expect(classify(version('v', 'p', 'h', { environment }), project('p', { client_side: 'required', server_side: 'unsupported' })))
      .toEqual({ side, source: 'version-environment' });
  });
  it.each([
    [{ client_side: 'required', server_side: 'optional' }, 'client'],
    [{ client_side: 'optional', server_side: 'required' }, 'server'],
    [{ client_side: 'unsupported', server_side: 'optional' }, 'server'],
    [{ client_side: 'required', server_side: 'unsupported' }, 'client'],
  ])('maps the legacy fields %j to %s', (fields, side) => {
    expect(legacySide(project('p', fields))).toBe(side);
    expect(classify(null, project('p', fields))).toEqual({ side, source: 'legacy-fields' });
  });
  it.each([
    [{}], [{ client_side: 'unknown', server_side: 'unknown' }], [{ client_side: 'required', server_side: 'required' }],
    [{ client_side: 'optional', server_side: 'optional' }], [{ client_side: 'unsupported', server_side: 'unsupported' }],
  ])('defaults missing, unknown and conflicting legacy fields %j to both', fields => {
    expect(legacySide(project('p', fields))).toBe(null);
    expect(classify(null, project('p', fields))).toEqual({ side: 'both', source: 'default' });
  });
  it('defaults a project environment that spans categories to both, and ignores unknown values', () => {
    expect(projectEnvironmentSide(['client_only', 'server_only'])).toBe('both');
    expect(projectEnvironmentSide(['server_only'])).toBe('server');
    expect(projectEnvironmentSide(['nonsense'])).toBe(null);
    expect(classify(version('v', 'p', 'h', { environment: 'nonsense' }), project('p', { environment: ['client_only'] })))
      .toEqual({ side: 'client', source: 'project-environment' });
  });
  it('reports nothing to classify when neither a version nor a project is known', () => {
    expect(classify(null, null)).toBe(null);
  });
});

describe('scanning, categories and the switch', () => {
  it('lists identified and unknown files, files the category into directories and keeps existing suffixes', async () => {
    await writeFile(join(mods, 'sodium.jar'), 'sodium');
    await writeFile(join(mods, 'lithium.jar'), 'lithium');
    await writeFile(join(mods, 'mystery.jar'), 'mystery');
    await writeFile(join(mods, 'paused.jar.disabled'), 'paused');
    const same = new Date('2026-01-01T00:00:00Z');
    for (const file of ['sodium.jar', 'lithium.jar', 'mystery.jar', 'paused.jar.disabled']) await utimes(join(mods, file), same, same);
    await start({
      versions: { [sha512('sodium')]: version('v1', 'p1', sha512('sodium'), { environment: 'client_only' }), [sha512('lithium')]: version('v2', 'p2', sha512('lithium'), { environment: 'server_only' }) },
      projects: { p1: project('p1'), p2: project('p2') },
    });
    const list = admin() as ReturnType<typeof admin> & { length: number };
    expect(list.map(mod => [mod.name, mod.side, mod.binding, mod.enabled])).toEqual([
      ['mystery', 'both', 'unbound', true], ['paused', 'both', 'unbound', false],
      ['Project p1', 'client', 'bound', true], ['Project p2', 'server', 'bound', true],
    ]);
    expect(await names()).toEqual(['client-only', 'lithium.jar', 'mystery.jar', 'paused.jar.disabled']);
    expect(await names(CLIENT_DIRECTORY)).toEqual(['sodium.jar']);
    expect(service.publicList().mods.map(mod => mod.name)).toEqual(['mystery', 'Project p1', 'Project p2']);
    expect(JSON.stringify(service.publicList())).not.toContain(mods);
  });

  it('orders the list by file modification time, newest first, and keeps the order across a switch', async () => {
    const times = { 'old.jar': '2026-01-01', 'new.jar': '2026-03-01', 'middle.jar': '2026-02-01' };
    for (const [file, time] of Object.entries(times)) {
      await writeFile(join(mods, file), file);
      await utimes(join(mods, file), new Date(time), new Date(time));
    }
    await start();
    expect(admin().map(mod => mod.fileName)).toEqual(['new.jar', 'middle.jar', 'old.jar']);
    expect(service.publicList().mods.map(mod => mod.name)).toEqual(['new', 'middle', 'old']);
    await service.update(admin().find(mod => mod.fileName === 'new.jar')!.id, { enabled: false });
    expect(admin().map(mod => mod.name)).toEqual(['new', 'middle', 'old']);
  });

  it.each([['both'], ['server'], ['client']] as const)('keeps the switch across a manual move to %s and back', async side => {
    await writeFile(join(mods, 'a.jar'), 'a');
    await start();
    const id = admin()[0].id;
    for (const enabled of [false, true, false]) {
      await service.update(id, { enabled });
      await service.update(id, { side });
      expect(admin(id).enabled).toBe(enabled);
      expect(admin(id).side).toBe(side);
      expect(admin(id).categorySource).toBe('manual');
      const folder = side === 'client' ? CLIENT_DIRECTORY : '.';
      expect(await names(folder)).toContain(enabled ? 'a.jar' : 'a.jar.disabled');
      await service.update(id, { side: null });
      expect(admin(id).enabled).toBe(enabled);
      expect(admin(id).manualSide).toBe(null);
    }
  });

  it('hides a disabled mod from the public list and its download, then restores both', async () => {
    await writeFile(join(mods, 'a.jar'), 'a');
    await start({ versions: { [sha512('a')]: version('v1', 'p1', sha512('a')) }, projects: { p1: project('p1') } });
    const id = admin()[0].id;
    expect((await service.download(id)).redirect).toBe('https://cdn.modrinth.com/v1.jar');
    await service.update(id, { enabled: false });
    expect(service.publicList().mods).toEqual([]);
    expect(admin(id).enabled).toBe(false);
    expect(admin(id).binding).toBe('bound');
    await expect(service.download(id)).rejects.toMatchObject({ status: 404 });
    await service.update(id, { enabled: true });
    expect(service.publicList().mods.map(mod => mod.id)).toEqual([id]);
    expect((await service.download(id)).redirect).toBe('https://cdn.modrinth.com/v1.jar');
  });

  it('adopts a suffix changed outside the panel and never re-enables a mod the administrator closed', async () => {
    await writeFile(join(mods, 'a.jar'), 'a');
    await start({ versions: { [sha512('a')]: version('v1', 'p1', sha512('a'), { environment: 'server_only' }) }, projects: { p1: project('p1') } });
    const id = admin()[0].id;
    await rename(join(mods, 'a.jar'), join(mods, 'a.jar.disabled'));
    await service.refresh();
    expect(admin(id).enabled).toBe(false);
    await service.refresh();
    expect(await names()).toEqual(['a.jar.disabled']);
    await service.update(id, { enabled: false });
    await service.resolve(id);
    expect(admin(id).enabled).toBe(false);
    expect(admin(id).side).toBe('server');
  });

  it('removes exactly one suffix when reopening a file that already ends in .disabled', async () => {
    await writeFile(join(mods, 'a.jar.disabled'), 'a');
    await start();
    const id = admin()[0].id;
    expect(admin(id).enabled).toBe(false);
    await service.update(id, { enabled: true });
    expect(await names()).toEqual(['a.jar']);
  });

  it('reports a move that would overwrite another file and keeps the source in place', async () => {
    await mkdir(join(mods, CLIENT_DIRECTORY));
    await writeFile(join(mods, 'a.jar'), 'root');
    await writeFile(join(mods, CLIENT_DIRECTORY, 'a.jar'), 'client');
    await start();
    const rootEntry = admin().find(mod => mod.side === 'both')!;
    await expect(service.update(rootEntry.id, { side: 'client' })).rejects.toMatchObject({ status: 409 });
    expect(await readFile(join(mods, 'a.jar'), 'utf8')).toBe('root');
    expect(await readFile(join(mods, CLIENT_DIRECTORY, 'a.jar'), 'utf8')).toBe('client');
    const failed = admin(rootEntry.id);
    expect(failed.side).toBe('client');
    expect(failed.error).toContain('已存在');
    await service.update(rootEntry.id, { side: null });
    expect(admin(rootEntry.id).error).toBe(null);
  });
});

describe('binding, configuration and downloads', () => {
  it('binds exactly, unbinds without touching the category or the switch, and re-identifies on request', async () => {
    await writeFile(join(mods, 'a.jar'), 'a');
    const data: Fake = { versions: { [sha512('a')]: version('v1', 'p1', sha512('a'), { environment: 'client_only' }) }, projects: { p1: project('p1') } };
    await start(data);
    const id = admin()[0].id;
    expect(admin(id)).toMatchObject({ binding: 'bound', projectId: 'p1', side: 'client', version: '1.2.3', categorySource: 'version-environment' });
    await service.update(id, { enabled: false });
    await service.unbind(id);
    expect(admin(id)).toMatchObject({ binding: 'unbound', projectId: 'p1', name: 'Project p1', side: 'client', enabled: false, version: '' });
    const before = data.calls!.versions;
    await service.refresh();
    expect(data.calls!.versions).toBe(before);
    expect(admin(id).binding).toBe('unbound');
    await service.resolve(id);
    expect(admin(id)).toMatchObject({ binding: 'bound', version: '1.2.3', enabled: false });
  });

  it('accepts a manual project and download address only while unbound, and keeps them across a restart', async () => {
    await writeFile(join(mods, 'a.jar'), 'a');
    const data: Fake = { versions: { [sha512('a')]: version('v1', 'p1', sha512('a')) }, projects: { p1: project('p1'), p2: project('p2'), pack: project('pack', { project_type: 'modpack' }) } };
    await start(data);
    const id = admin()[0].id;
    await expect(service.update(id, { projectId: 'p2' })).rejects.toMatchObject({ status: 409 });
    await service.unbind(id);
    await expect(service.update(id, { projectId: 'pack' })).rejects.toMatchObject({ status: 400 });
    await expect(service.update(id, { projectId: 'missing' })).rejects.toMatchObject({ status: 404 });
    await expect(service.update(id, { downloadUrl: 'ftp://example.test/a.jar' })).rejects.toMatchObject({ status: 400 });
    await service.update(id, { projectId: 'p2', downloadUrl: 'https://example.test/a.jar' });
    expect(admin(id)).toMatchObject({ projectId: 'p2', name: 'Project p2', binding: 'unbound', side: 'both' });
    expect((await service.download(id)).redirect).toBe('https://example.test/a.jar');
    await service.close();
    await start(data);
    expect(admin()[0]).toMatchObject({ projectId: 'p2', downloadUrl: 'https://example.test/a.jar', binding: 'unbound' });
    expect(data.calls!.versions).toBe(0);
  });

  it('serves the local file when nothing remote is configured and refuses a stale entry', async () => {
    await writeFile(join(mods, 'a.jar'), 'a');
    await start();
    const id = admin()[0].id;
    const result = await service.download(id);
    expect(result.path).toBe(join(mods, 'a.jar'));
    expect(result.fileName).toBe('a.jar');
    await rm(join(mods, 'a.jar'));
    await service.refresh();
    await expect(service.download(id)).rejects.toMatchObject({ status: 404 });
    await expect(service.download('../../etc/passwd')).rejects.toMatchObject({ status: 404 });
  });

  it('separates a lookup failure from a miss and keeps every existing result', async () => {
    await writeFile(join(mods, 'a.jar'), 'a');
    await writeFile(join(mods, 'b.jar'), 'b');
    const data: Fake = { versions: { [sha512('a')]: version('v1', 'p1', sha512('a'), { environment: 'client_only' }) }, projects: { p1: project('p1') } };
    await start(data);
    const bound = admin().find(mod => mod.binding === 'bound')!;
    const miss = admin().find(mod => mod.binding === 'unbound')!;
    expect(miss).toMatchObject({ name: 'b', side: 'both', resolving: false, error: null });
    await writeFile(join(mods, 'c.jar'), 'c');
    data.failVersions = () => Object.assign(new Error('rate limited'), { name: 'ModrinthError' });
    data.failProjects = data.failVersions;
    await service.refresh();
    expect(admin(bound.id)).toMatchObject({ binding: 'bound', side: 'client', enabled: true });
    expect(admin().find(mod => mod.fileName === 'c.jar')!.error).toBeTruthy();
    expect(await names()).toEqual(['b.jar', 'c.jar', 'client-only']);
  });
});

describe('directory changes and recovery', () => {
  it('follows additions, deletions, replacements and renames, and lists duplicate files separately', async () => {
    await writeFile(join(mods, 'a.jar'), 'a');
    const data: Fake = {
      versions: { [sha512('a')]: version('v1', 'p1', sha512('a')), [sha512('a2')]: version('v2', 'p1', sha512('a2'), { version_number: '2.0.0' }) },
      projects: { p1: project('p1') },
    };
    await start(data);
    const id = admin()[0].id;
    await service.update(id, { side: 'server' });
    await writeFile(join(mods, 'a.jar'), 'a2');
    await service.refresh();
    expect(admin(id)).toMatchObject({ version: '2.0.0', side: 'server', manualSide: 'server' });
    await rename(join(mods, 'a.jar'), join(mods, 'renamed.jar'));
    await service.refresh();
    expect(admin()).toHaveLength(1);
    expect(admin(id)).toMatchObject({ fileName: 'renamed.jar', manualSide: 'server' });
    await writeFile(join(mods, 'copy.jar'), 'a2');
    await service.refresh();
    expect(admin()).toHaveLength(2);
    expect(new Set(admin().map(mod => mod.id)).size).toBe(2);
    await rm(join(mods, 'renamed.jar'));
    await rm(join(mods, 'copy.jar'));
    await service.refresh();
    expect(admin()).toEqual([]);
    expect(service.publicList().mods).toEqual([]);
  });

  it('keeps each directory separate and ignores results from the one it left', async () => {
    const other = join(directory, 'other');
    await mkdir(other);
    await writeFile(join(mods, 'a.jar'), 'a');
    await writeFile(join(other, 'b.jar'), 'b');
    await start();
    const id = admin()[0].id;
    await service.update(id, { side: 'server', enabled: false });
    await service.use(other);
    expect(admin().map(mod => mod.fileName)).toEqual(['b.jar']);
    await expect(service.download(id)).rejects.toMatchObject({ status: 404 });
    await service.use(mods);
    expect(admin()[0]).toMatchObject({ fileName: 'a.jar', manualSide: 'server', enabled: false });
    await service.use(null);
    expect(service.adminList()).toMatchObject({ mods: [], configured: false });
  });

  it('restores administrator state after a restart and raises the revision on every change', async () => {
    await writeFile(join(mods, 'a.jar'), 'a');
    await start();
    const id = admin()[0].id;
    await service.update(id, { enabled: false, side: 'client' });
    const revisions: number[] = [];
    service.subscribe(value => revisions.push(value));
    await service.update(id, { side: 'server' });
    expect(revisions.length).toBeGreaterThan(0);
    expect(await names(CLIENT_DIRECTORY)).toEqual([]);
    expect(await names()).toContain('a.jar.disabled');
    await service.close();
    await start();
    expect(admin()[0]).toMatchObject({ id, enabled: false, manualSide: 'server', fileName: 'a.jar' });
  });

  it('waits for a file to stop changing before hashing it', async () => {
    service = await createModService({ dataDirectory: join(directory, 'data'), modrinth: fakeModrinth({}), watchFiles: false, pollInterval: 3_600_000, settleDelay: 60_000 });
    await writeFile(join(mods, 'a.jar'), 'a');
    await service.use(mods);
    expect(admin()[0]).toMatchObject({ fileName: 'a.jar', resolving: true, binding: 'unbound' });
    expect(service.publicList().mods).toHaveLength(1);
  });
});

describe('interrupted operations', () => {
  it('finishes a switch that was recorded but never applied to the file', async () => {
    await writeFile(join(mods, 'a.jar'), 'a');
    await start();
    const id = admin()[0].id;
    await service.close();
    // Stand in for a crash between recording the intent and renaming the file.
    const state = JSON.parse(await readFile(join(directory, 'data', 'mods.json'), 'utf8'));
    state.directories[mods][0] = { ...state.directories[mods][0], desiredEnabled: false, pending: true };
    await writeFile(join(directory, 'data', 'mods.json'), JSON.stringify(state));
    await start();
    expect(await names()).toEqual(['a.jar.disabled']);
    expect(admin()[0]).toMatchObject({ id, enabled: false });
  });
});

describe('permission and availability problems', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('keeps every entry and setting while the directory is unavailable, reports why, and recovers', async () => {
    await writeFile(join(mods, 'a.jar'), 'a');
    await start();
    const id = admin()[0].id;
    await service.update(id, { side: 'server' });
    expect(service.adminList().issues).toEqual([]);
    const revisions: number[] = [];
    service.subscribe(value => revisions.push(value));
    await rename(mods, `${mods}-away`);
    await service.refresh();
    expect(service.adminList().issues).toEqual([expect.stringContaining('模组目录不存在')]);
    expect(service.adminList().scanning).toBe(false);
    expect(admin(id)).toMatchObject({ fileName: 'a.jar', manualSide: 'server' });
    expect(revisions).toHaveLength(1);
    await service.refresh();
    expect(revisions).toHaveLength(1);
    await rename(`${mods}-away`, mods);
    await service.refresh();
    expect(service.adminList().issues).toEqual([]);
    expect(admin(id)).toMatchObject({ fileName: 'a.jar', manualSide: 'server' });
  });

  it('retries a failed move on later cycles, so it completes once the obstacle is gone', async () => {
    await mkdir(join(mods, CLIENT_DIRECTORY));
    await writeFile(join(mods, 'a.jar'), 'root');
    await writeFile(join(mods, CLIENT_DIRECTORY, 'a.jar'), 'client');
    await start();
    const id = admin().find(mod => mod.side === 'both')!.id;
    await expect(service.update(id, { side: 'client' })).rejects.toMatchObject({ status: 409 });
    const revisions: number[] = [];
    service.subscribe(value => revisions.push(value));
    await service.refresh();
    expect(revisions).toEqual([]);
    await rename(join(mods, CLIENT_DIRECTORY, 'a.jar'), join(mods, 'b.jar'));
    await service.refresh();
    expect(admin(id)).toMatchObject({ side: 'client', error: null });
    expect(await readFile(join(mods, CLIENT_DIRECTORY, 'a.jar'), 'utf8')).toBe('root');
  });

  it('reports state that cannot be saved and clears the warning once saving works again', async () => {
    const data = join(directory, 'data');
    await mkdir(join(data, 'mods.json'));
    await writeFile(join(mods, 'a.jar'), 'a');
    await start();
    expect(service.adminList().issues).toEqual([expect.stringContaining('无法保存模组状态')]);
    await rm(join(data, 'mods.json'), { recursive: true });
    await service.refresh();
    expect(service.adminList().issues).toEqual([]);
    expect(JSON.parse(await readFile(join(data, 'mods.json'), 'utf8')).directories[mods]).toHaveLength(1);
  });
});
