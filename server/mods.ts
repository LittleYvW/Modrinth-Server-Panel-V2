import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream, watch, type FSWatcher } from 'node:fs';
import { lstat, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { once } from 'node:events';
import { pipeline } from 'node:stream/promises';
import type { AdminMod, AdminModList, DisplaySettings, ModBinding, ModCategorySource, ModSide, ModUpdate, PublicMod, PublicModList } from '../shared/types.js';
import { defaultDisplay, modSides } from '../shared/types.js';
import { classify, createModrinth, ModrinthError, versionFileUrl, type Modrinth, type ModrinthProject } from './modrinth.js';
import { dataWriteProblem, errorCode, HttpError, isPermissionError } from './errors.js';
import { probeWritable } from './directory.js';

export const CLIENT_DIRECTORY = 'client-only';
const JAR = '.jar';
const DISABLED = '.disabled';
const SETTLE = 1000;
const POLL = 10 * 1000;
const DEBOUNCE = 300;
const RESOLVE_BACKOFF = 60 * 1000;
const ORPHAN_TTL = 5 * 60 * 1000;
const ORPHAN_LIMIT = 200;
const MOVE_ATTEMPTS = 6;
const PROJECT_REFERENCE = /^[A-Za-z0-9!@$().+_'-]{1,64}$/;

type Location = 'root' | 'client-only';
type VersionInfo = { id: string; number: string; url: string | null };
type ProjectInfo = { id: string; slug: string | null; title: string | null; description: string | null; iconUrl: string | null };
type Entry = {
  id: string;
  fileName: string;
  location: Location;
  enabled: boolean;
  desiredEnabled: boolean;
  pending: boolean;
  size: number;
  mtimeMs: number;
  hash: string | null;
  resolved: boolean;
  manualSide: ModSide | null;
  autoSide: ModSide;
  autoSource: ModCategorySource;
  bound: boolean;
  autoBindDisabled: boolean;
  projectId: string | null;
  project: ProjectInfo | null;
  version: VersionInfo | null;
  downloadUrl: string | null;
  lookupError: string | null;
  readError: string | null;
  moveError: string | null;
};
type Found = { location: Location; fileName: string; enabled: boolean; size: number; mtimeMs: number };
type StoredState = { version: 1; directories: Record<string, Entry[]> };

export const locationForSide = (side: ModSide): Location => side === 'client' ? 'client-only' : 'root';
const effectiveSide = (entry: Entry): ModSide => entry.manualSide ?? entry.autoSide;
const sourceOf = (entry: Entry): ModCategorySource => entry.manualSide ? 'manual' : entry.autoSource;
const displayName = (entry: Entry) => entry.project?.title?.trim() || entry.fileName.replace(/\.jar$/i, '');

function locationDirectory(directory: string, location: Location) {
  return location === 'client-only' ? join(directory, CLIENT_DIRECTORY) : directory;
}
export function modFilePath(directory: string, location: Location, fileName: string, enabled: boolean) {
  return join(locationDirectory(directory, location), enabled ? fileName : fileName + DISABLED);
}
// Names come from readdir, but a download path is rebuilt from stored state, so re-check it before use.
function safeFileName(name: string) {
  return !!name && !name.includes('/') && !name.includes('\\') && !name.includes('\0')
    && !name.startsWith('.') && name.toLowerCase().endsWith(JAR);
}
function message(error: unknown) {
  if (error instanceof HttpError || error instanceof ModrinthError) return error.message;
  const code = errorCode(error);
  if (isPermissionError(error)) return '没有修改该文件的权限，请检查运行用户对模组目录的写权限。';
  if (code === 'EEXIST') return '目标位置已存在同名文件。';
  if (code === 'ENOENT') return '文件已不存在。';
  if (code === 'EBUSY') return '文件正被占用，请稍后重试。';
  return '文件操作失败，请检查目录权限。';
}

async function hashFile(path: string) {
  const digest = createHash('sha512');
  const source = createReadStream(path);
  try { await pipeline(source, digest); }
  finally {
    source.destroy();
    if (!source.closed) await once(source, 'close').catch(() => undefined);
  }
  return digest.digest('hex');
}

const exists = (path: string) => lstat(path).then(() => true, () => false);

// Moves never replace a file that is already there. Windows can keep a brief handle on a file that was
// just read or created, which surfaces as a transient lock rather than a real permission problem.
async function moveFile(from: string, to: string) {
  if (await exists(to)) throw Object.assign(new Error('Target exists'), { code: 'EEXIST' });
  for (let attempt = 1; ; attempt++) {
    try { return await rename(from, to); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= MOVE_ATTEMPTS || !(code === 'EPERM' || code === 'EACCES' || code === 'EBUSY')) throw error;
      if (await exists(to)) throw Object.assign(new Error('Target exists'), { code: 'EEXIST' });
      await new Promise(resolve => setTimeout(resolve, 40 * attempt));
    }
  }
}

// A missing mods directory is an error, not an empty list: treating an unmounted or unreadable directory as
// empty would forget every administrator setting on the next save.
async function scanLocation(directory: string, location: Location): Promise<Found[]> {
  const base = locationDirectory(directory, location);
  const where = location === 'client-only' ? `${CLIENT_DIRECTORY} 子目录` : '模组目录';
  let listing;
  try { listing = await readdir(base, { withFileTypes: true }); }
  catch (error) {
    const code = errorCode(error);
    if (code === 'ENOENT' && location === 'client-only') return [];
    if (isPermissionError(error)) throw new Error(`没有读取${where}的权限，列表暂停更新。请检查运行用户的访问权限。`);
    if (code === 'ENOENT' || code === 'ENOTDIR') throw new Error(`${where}不存在或不是目录，列表暂停更新。请检查路径或磁盘挂载。`);
    throw new Error(`无法读取${where}，列表暂停更新。请检查路径和访问权限。`);
  }
  const found: Found[] = [];
  for (const file of listing) {
    // Dirent flags follow lstat, so symbolic links and directories drop out without being followed.
    if (!file.isFile()) continue;
    const lower = file.name.toLowerCase();
    const enabled = lower.endsWith(JAR);
    const fileName = enabled ? file.name : lower.endsWith(JAR + DISABLED) ? file.name.slice(0, -DISABLED.length) : null;
    if (!fileName || !safeFileName(fileName)) continue;
    const info = await stat(join(base, file.name)).catch(() => null);
    if (!info?.isFile()) continue;
    found.push({ location, fileName, enabled, size: info.size, mtimeMs: info.mtimeMs });
  }
  return found;
}

function matchFiles(entries: Entry[], found: Found[]) {
  const pairs = new Map<string, Found>();
  const freeEntries = new Set(entries);
  const freeFound = new Set(found);
  for (const file of [...freeFound]) {
    const entry = [...freeEntries].find(candidate => candidate.location === file.location && candidate.fileName === file.fileName);
    if (entry) { pairs.set(entry.id, file); freeEntries.delete(entry); freeFound.delete(file); }
  }
  // The same logical name in the other directory is this panel's own move, or an administrator's.
  for (const file of [...freeFound]) {
    const candidates = [...freeEntries].filter(candidate => candidate.fileName === file.fileName);
    if (candidates.length === 1) { pairs.set(candidates[0].id, file); freeEntries.delete(candidates[0]); freeFound.delete(file); }
  }
  return { pairs, removed: [...freeEntries], added: [...freeFound] };
}

export type ModService = Awaited<ReturnType<typeof createModService>>;

export async function createModService(options: {
  dataDirectory: string;
  modrinth?: Modrinth;
  watchFiles?: boolean;
  pollInterval?: number;
  settleDelay?: number;
}) {
  const modrinth = options.modrinth ?? createModrinth();
  const stateFile = join(options.dataDirectory, 'mods.json');
  const settle = options.settleDelay ?? SETTLE;
  const poll = options.pollInterval ?? POLL;
  const listeners = new Set<(revision: number) => void>();
  let saved: StoredState = { version: 1, directories: {} };
  // A state file that exists but cannot be read is never overwritten: that would silently drop every setting in it.
  let locked: string | null = null;
  try {
    const parsed = JSON.parse(await readFile(stateFile, 'utf8')) as StoredState;
    if (parsed?.version === 1 && parsed.directories && typeof parsed.directories === 'object') saved = parsed;
  } catch (error) {
    if (isPermissionError(error)) locked = '没有读取数据目录中 mods.json 的权限，模组设置暂不保存。请修复权限后重启服务。';
    else if (errorCode(error) !== 'ENOENT') console.error('Mod state file unreadable; starting from the directory contents.');
  }

  let directory: string | null = null;
  let entries: Entry[] = [];
  let orphans: { entry: Entry; time: number }[] = [];
  let revision = 0;
  let scanned = false;
  let generation = 0;
  let queue: Promise<unknown> = Promise.resolve();
  let watchers: FSWatcher[] = [];
  let timer: NodeJS.Timeout | null = null;
  let settleTimer: NodeJS.Timeout | null = null;
  let debounce: NodeJS.Timeout | null = null;
  let backoffUntil = 0;
  let closed = false;
  let display: DisplaySettings = defaultDisplay;
  // Directory-wide problems, shown above the admin list until they clear on their own.
  const issues: { scan: string | null; write: string | null; save: string | null } = { scan: null, write: null, save: locked };
  if (locked) console.error(`Mod panel problem (save): ${locked}`);

  function report(kind: keyof typeof issues, text: string | null) {
    if (issues[kind] === text) return false;
    if (text) console.error(`Mod panel problem (${kind}): ${text}`);
    else console.log(`Mod panel problem cleared (${kind}).`);
    issues[kind] = text;
    return true;
  }

  function announce() {
    revision++;
    for (const listener of [...listeners]) {
      try { listener(revision); } catch { /* One broken stream must not stop the others. */ }
    }
  }
  async function persist() {
    if (directory) saved.directories[directory] = entries.map(entry => ({ ...entry }));
    if (locked) return false;
    const temporary = `${stateFile}.${randomBytes(8).toString('hex')}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(saved), { mode: 0o600, flag: 'wx' });
      await rename(temporary, stateFile);
      return report('save', null);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      return report('save', `${dataWriteProblem(error, '模组状态')}重启后手动设置可能丢失。`);
    }
  }
  // The files themselves are the truth for switches and categories, so only moves need write access.
  async function checkWritable() {
    const client = locationDirectory(directory!, 'client-only');
    const writable = await probeWritable(directory!)
      && (!await stat(client).then(info => info.isDirectory(), () => false) || await probeWritable(client));
    return report('write', writable ? null : '模组目录不可写：开关与分类调整无法生效。请授予运行用户对模组目录（含 client-only）的写权限。');
  }
  function serialize<T>(work: () => Promise<T>): Promise<T> {
    const operation = queue.then(work);
    queue = operation.catch(() => undefined);
    return operation;
  }

  function restore(list: unknown): Entry[] {
    if (!Array.isArray(list)) return [];
    return list.flatMap((value): Entry[] => {
      const raw = value as Partial<Entry>;
      if (typeof raw?.id !== 'string' || typeof raw.fileName !== 'string' || !safeFileName(raw.fileName)) return [];
      return [{
        id: raw.id,
        fileName: raw.fileName,
        location: raw.location === 'client-only' ? 'client-only' : 'root',
        enabled: raw.enabled !== false,
        desiredEnabled: raw.desiredEnabled !== false,
        pending: raw.pending === true,
        size: typeof raw.size === 'number' ? raw.size : 0,
        mtimeMs: typeof raw.mtimeMs === 'number' ? raw.mtimeMs : 0,
        hash: typeof raw.hash === 'string' ? raw.hash : null,
        resolved: raw.resolved === true,
        manualSide: modSides.includes(raw.manualSide as ModSide) ? raw.manualSide as ModSide : null,
        autoSide: modSides.includes(raw.autoSide as ModSide) ? raw.autoSide as ModSide : 'both',
        autoSource: typeof raw.autoSource === 'string' ? raw.autoSource as ModCategorySource : 'default',
        bound: raw.bound === true,
        autoBindDisabled: raw.autoBindDisabled === true,
        projectId: typeof raw.projectId === 'string' ? raw.projectId : null,
        project: raw.project && typeof raw.project.id === 'string' ? raw.project : null,
        version: raw.version && typeof raw.version.id === 'string' ? raw.version : null,
        downloadUrl: typeof raw.downloadUrl === 'string' ? raw.downloadUrl : null,
        lookupError: null,
        readError: null,
        moveError: null,
      }];
    });
  }

  function newEntry(file: Found): Entry {
    // Nothing is known yet, so the directory the file already sits in decides its starting category.
    return {
      id: randomUUID(), fileName: file.fileName, location: file.location, enabled: file.enabled, desiredEnabled: file.enabled,
      pending: false, size: file.size, mtimeMs: file.mtimeMs, hash: null, resolved: false,
      manualSide: null, autoSide: file.location === 'client-only' ? 'client' : 'both',
      autoSource: file.location === 'client-only' ? 'location' : 'default',
      bound: false, autoBindDisabled: false, projectId: null, project: null, version: null, downloadUrl: null,
      lookupError: null, readError: null, moveError: null,
    };
  }

  function rememberOrphans(removed: Entry[]) {
    const time = Date.now();
    for (const entry of removed) if (entry.hash) orphans.push({ entry, time });
    orphans = orphans.filter(item => time - item.time < ORPHAN_TTL).slice(-ORPHAN_LIMIT);
  }
  // A rename made outside the panel only carries settings across when exactly one departed file had this content.
  function inherit(entry: Entry) {
    if (!entry.hash) return;
    const matches = orphans.filter(item => item.entry.hash === entry.hash);
    if (matches.length !== 1) return;
    const previous = matches[0].entry;
    orphans = orphans.filter(item => item !== matches[0]);
    Object.assign(entry, {
      id: previous.id, manualSide: previous.manualSide, autoSide: previous.autoSide, autoSource: previous.autoSource,
      bound: previous.bound, autoBindDisabled: previous.autoBindDisabled, projectId: previous.projectId,
      project: previous.project, version: previous.version, downloadUrl: previous.downloadUrl, resolved: previous.resolved,
    });
  }

  // Hashing waits for the file to stop changing; a change during the read sends it back to the queue.
  async function refreshHash(entry: Entry, current: number) {
    const path = modFilePath(directory!, entry.location, entry.fileName, entry.enabled);
    const before = await stat(path).catch(() => null);
    if (!before?.isFile() || (settle > 0 && Date.now() - before.mtimeMs < settle)) return false;
    let hash: string;
    try { hash = await hashFile(path); }
    catch (error) {
      // A lock is transient and retried quietly; a denied read will not fix itself, so the administrator hears about it.
      const text = isPermissionError(error) ? '没有读取该文件的权限，无法识别。请检查运行用户的访问权限。' : null;
      if (current !== generation || entry.readError === text) return false;
      entry.readError = text;
      return true;
    }
    const after = await stat(path).catch(() => null);
    if (current !== generation) return false;
    if (!after?.isFile() || after.mtimeMs !== before.mtimeMs || after.size !== before.size) return false;
    entry.hash = hash;
    entry.readError = null;
    entry.size = after.size;
    entry.mtimeMs = after.mtimeMs;
    entry.resolved = false;
    inherit(entry);
    return true;
  }

  async function reconcile(entry: Entry, current: number) {
    const wanted = { location: locationForSide(effectiveSide(entry)), enabled: entry.desiredEnabled };
    if (wanted.location === entry.location && wanted.enabled === entry.enabled) {
      const settled = entry.pending || entry.moveError;
      entry.pending = false; entry.moveError = null;
      return !!settled;
    }
    const from = modFilePath(directory!, entry.location, entry.fileName, entry.enabled);
    const to = modFilePath(directory!, wanted.location, entry.fileName, wanted.enabled);
    // A failed move is retried on every cycle, so it completes by itself once permissions are fixed, the lock
    // is released or the conflicting file is gone; repeating the same failure is not news for the clients.
    let creating = wanted.location === 'client-only';
    try {
      if (creating) await mkdir(join(directory!, CLIENT_DIRECTORY), { recursive: true });
      creating = false;
      await moveFile(from, to);
      if (current !== generation) return false;
      entry.location = wanted.location;
      entry.enabled = wanted.enabled;
      entry.pending = false; entry.moveError = null;
    } catch (error) {
      if (current !== generation) return false;
      const text = creating && isPermissionError(error)
        ? `无法创建 ${CLIENT_DIRECTORY} 子目录：没有写入模组目录的权限。` : message(error);
      if (entry.moveError === text) return false;
      entry.moveError = text;
    }
    return true;
  }

  function projectInfo(project: ModrinthProject): ProjectInfo {
    return {
      id: project.id,
      slug: typeof project.slug === 'string' ? project.slug : null,
      title: typeof project.title === 'string' ? project.title : null,
      description: typeof project.description === 'string' ? project.description : null,
      iconUrl: typeof project.icon_url === 'string' ? project.icon_url : null,
    };
  }

  async function identify(current: number, forced?: Entry) {
    const targets = forced ? [forced] : entries.filter(entry => entry.hash && !entry.resolved && !entry.autoBindDisabled);
    if (!targets.length || (!forced && Date.now() < backoffUntil)) return false;
    try {
      const versions = await modrinth.versionsByHash(targets.map(entry => entry.hash!));
      if (current !== generation) return false;
      const wanted = new Set<string>();
      for (const entry of targets) {
        const version = versions.get(entry.hash!.toLowerCase());
        const projectId = version?.project_id ?? entry.projectId;
        if (projectId) wanted.add(projectId);
      }
      const projects = wanted.size ? await modrinth.projects([...wanted]) : new Map<string, ModrinthProject>();
      if (current !== generation) return false;
      for (const entry of targets) {
        const version = versions.get(entry.hash!.toLowerCase()) ?? null;
        const projectId = version?.project_id ?? entry.projectId ?? null;
        const project = projectId ? projects.get(projectId) ?? null : null;
        entry.resolved = true;
        entry.lookupError = null;
        entry.projectId = projectId;
        if (project) entry.project = projectInfo(project);
        entry.version = version ? { id: version.id, number: version.version_number ?? version.name ?? '', url: versionFileUrl(version, entry.hash!) } : null;
        // An exact binding needs both a hash match and project metadata to show for it.
        entry.bound = !!(version && (project || entry.project));
        const category = classify(version, project);
        entry.autoSide = category?.side ?? (entry.location === 'client-only' ? 'client' : 'both');
        entry.autoSource = category?.source ?? (entry.location === 'client-only' ? 'location' : 'default');
      }
      backoffUntil = 0;
    } catch (error) {
      if (current !== generation) return false;
      // A failed lookup never discards a binding, a category or a file; it only records why it failed,
      // and repeating the same failure is not a change worth telling the clients about.
      backoffUntil = Date.now() + RESOLVE_BACKOFF;
      const text = message(error);
      let noted = false;
      for (const entry of targets) if (entry.lookupError !== text) { entry.lookupError = text; noted = true; }
      return noted;
    }
    return true;
  }

  function scheduleSettle() {
    // Unreadable files wait for the regular interval instead of spinning on the short settle timer.
    if (settleTimer || closed || !entries.some(entry => !entry.hash && !entry.readError)) return;
    settleTimer = setTimeout(() => { settleTimer = null; void cycle(); }, settle + 100);
    settleTimer.unref?.();
  }

  async function cycle(): Promise<void> {
    if (!directory || closed) return;
    const current = generation;
    return serialize(async () => {
      if (current !== generation || !directory || closed) return;
      let changed = !scanned;
      let found: Found[];
      try { found = [...await scanLocation(directory, 'root'), ...await scanLocation(directory, 'client-only')]; }
      catch (error) {
        // Keep the last known list and every setting; only say why it stopped updating.
        if (current === generation && report('scan', (error as Error).message)) announce();
        return;
      }
      if (current !== generation) return;
      if (report('scan', null)) changed = true;
      // Probe once per directory, then only while it is known to be read-only so the warning clears promptly.
      if ((!scanned || issues.write) && await checkWritable()) changed = true;
      if (current !== generation) return;
      const { pairs, removed, added } = matchFiles(entries, found);
      if (removed.length) { rememberOrphans(removed); changed = true; }
      const next = entries.filter(entry => pairs.has(entry.id));
      for (const entry of next) {
        const file = pairs.get(entry.id)!;
        if (entry.location !== file.location || entry.enabled !== file.enabled) changed = true;
        entry.location = file.location;
        entry.enabled = file.enabled;
        // Without an operation of ours in flight, a suffix changed outside the panel is the real state.
        if (!entry.pending) entry.desiredEnabled = file.enabled;
        if (entry.size !== file.size || entry.mtimeMs !== file.mtimeMs) {
          entry.size = file.size; entry.mtimeMs = file.mtimeMs; entry.hash = null; entry.resolved = false;
          entry.moveError = null;
          changed = true;
        }
      }
      for (const file of added) { next.push(newEntry(file)); changed = true; }
      entries = next;
      for (const entry of entries) if (!entry.hash && await refreshHash(entry, current)) changed = true;
      if (current !== generation) return;
      if (await identify(current)) changed = true;
      if (current !== generation) return;
      for (const entry of entries) if (await reconcile(entry, current)) changed = true;
      if (current !== generation) return;
      scanned = true;
      // A failed save is retried every cycle until the data directory accepts it again.
      if (changed || issues.save) { if (await persist() || changed) announce(); }
      scheduleSettle();
    });
  }

  function stopWatching() {
    for (const watcher of watchers) watcher.close();
    watchers = [];
    if (timer) { clearInterval(timer); timer = null; }
    if (debounce) { clearTimeout(debounce); debounce = null; }
    if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
  }
  function startWatching() {
    if (!directory || options.watchFiles === false) return;
    const trigger = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => { debounce = null; void cycle(); }, DEBOUNCE);
      debounce.unref?.();
    };
    for (const location of ['root', 'client-only'] as Location[]) {
      try {
        const watcher = watch(locationDirectory(directory, location), trigger);
        watcher.on('error', () => { /* The interval below compensates for a dropped watcher. */ });
        watchers.push(watcher);
      } catch { /* A missing client-only directory is normal; the interval picks it up. */ }
    }
  }

  function entryOf(id: unknown) {
    const entry = typeof id === 'string' ? entries.find(item => item.id === id) : undefined;
    if (!entry) throw new HttpError(404, '该模组条目不存在，请刷新列表。');
    return entry;
  }
  function toPublic(entry: Entry): PublicMod {
    return {
      id: entry.id,
      name: displayName(entry),
      description: entry.project?.description?.trim() || '',
      version: entry.version?.number ?? '',
      iconUrl: entry.project?.iconUrl ?? null,
      projectUrl: entry.project ? `https://modrinth.com/mod/${entry.project.slug ?? entry.project.id}` : null,
      side: effectiveSide(entry),
    };
  }
  function toAdmin(entry: Entry): AdminMod {
    return {
      ...toPublic(entry),
      fileName: entry.fileName,
      enabled: entry.enabled,
      categorySource: sourceOf(entry),
      manualSide: entry.manualSide,
      binding: (entry.bound ? 'bound' : 'unbound') as ModBinding,
      projectId: entry.projectId,
      downloadUrl: entry.downloadUrl,
      resolving: !entry.readError && (!entry.hash || (!entry.resolved && !entry.autoBindDisabled && !entry.lookupError)),
      error: entry.moveError ?? entry.readError ?? entry.lookupError,
    };
  }
  const publicSides = () => modSides.filter(side => side === 'both'
    || (side === 'server' ? display.showServerMods : display.showClientMods));
  const ordered = () => [...entries].sort((a, b) => displayName(a).localeCompare(displayName(b), 'zh-Hans-CN') || a.fileName.localeCompare(b.fileName));

  function downloadAddress(value: unknown) {
    if (value === null || value === '') return null;
    const invalid = new HttpError(400, '请输入有效的 HTTP(S) 下载地址。');
    if (typeof value !== 'string' || value.length > 2048) throw invalid;
    let url: URL;
    try { url = new URL(value.trim()); } catch { throw invalid; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw invalid;
    return url.toString();
  }

  return {
    get directory() { return directory; },
    subscribe(listener: (revision: number) => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async use(next: string | null) {
      if (next === directory) return;
      // Switching directories retires every in-flight task; a late result sees a stale generation and stops.
      generation++;
      stopWatching();
      directory = next;
      entries = next ? restore(saved.directories[next]) : [];
      orphans = [];
      scanned = false;
      backoffUntil = 0;
      issues.scan = null; issues.write = null;
      announce();
      if (!next || closed) return;
      startWatching();
      timer = setInterval(() => { void cycle(); }, poll);
      timer.unref?.();
      await cycle();
    },
    // Hidden categories disappear from the public list and their downloads, but stay manageable.
    setDisplay(next: DisplaySettings) {
      if (next.showServerMods === display.showServerMods && next.showClientMods === display.showClientMods) return;
      display = { ...next };
      announce();
    },
    publicList(): PublicModList {
      const sides = publicSides();
      return { revision, mods: ordered().filter(entry => entry.enabled && sides.includes(effectiveSide(entry))).map(toPublic), sides };
    },
    adminList(): AdminModList {
      return {
        revision, mods: ordered().map(toAdmin), scanning: !!directory && !scanned && !issues.scan, configured: !!directory,
        issues: [issues.scan, issues.write, issues.save].filter((text): text is string => !!text),
      };
    },
    refresh: () => cycle(),
    update(id: unknown, patch: ModUpdate) {
      return serialize(async () => {
        if (!directory) throw new HttpError(409, '请先在设置中配置模组目录。');
        const entry = entryOf(id);
        const current = generation;
        if ('side' in patch) {
          if (!(patch.side === null || modSides.includes(patch.side as ModSide))) throw new HttpError(400, '请选择有效的模组分类。');
          entry.manualSide = patch.side ?? null;
        }
        if (('projectId' in patch || 'downloadUrl' in patch) && entry.bound) {
          throw new HttpError(409, '已绑定 Modrinth 的模组请先取消绑定，再手动配置。');
        }
        if ('downloadUrl' in patch) entry.downloadUrl = downloadAddress(patch.downloadUrl);
        if ('projectId' in patch) {
          const value = patch.projectId;
          if (value === null || value === '') { entry.projectId = null; entry.project = null; }
          else {
            if (typeof value !== 'string' || !PROJECT_REFERENCE.test(value.trim())) throw new HttpError(400, '请输入有效的 Modrinth 项目 ID 或 slug。');
            const project = await modrinth.project(value.trim()).catch(error => { throw new HttpError(502, message(error)); });
            if (current !== generation) throw new HttpError(409, '模组目录已切换，请重新操作。');
            if (!project) throw new HttpError(404, '未找到该 Modrinth 项目。');
            if (project.project_type && project.project_type !== 'mod') throw new HttpError(400, '该 Modrinth 项目不是模组。');
            entry.projectId = project.id;
            entry.project = projectInfo(project);
          }
        }
        if ('enabled' in patch) {
          if (typeof patch.enabled !== 'boolean') throw new HttpError(400, '开关状态无效。');
          entry.desiredEnabled = patch.enabled;
          entry.pending = patch.enabled !== entry.enabled;
          entry.moveError = null;
        }
        // The intent is on disk before the file moves, so an interrupted operation resumes on the next scan.
        await persist();
        await reconcile(entry, current);
        await persist();
        announce();
        if (entry.moveError) throw new HttpError(409, entry.moveError);
        return toAdmin(entry);
      });
    },
    unbind(id: unknown) {
      return serialize(async () => {
        const entry = entryOf(id);
        if (!entry.bound) throw new HttpError(409, '该模组当前未绑定 Modrinth。');
        // The project metadata, category and switch stay exactly as they are; only the exact version goes.
        entry.bound = false;
        entry.version = null;
        entry.autoBindDisabled = true;
        entry.resolved = true;
        entry.lookupError = null;
        await persist();
        announce();
        return toAdmin(entry);
      });
    },
    resolve(id: unknown) {
      return serialize(async () => {
        if (!directory) throw new HttpError(409, '请先在设置中配置模组目录。');
        const entry = entryOf(id);
        const current = generation;
        entry.autoBindDisabled = false;
        entry.resolved = false;
        entry.lookupError = null;
        if (!entry.hash) await refreshHash(entry, current);
        if (!entry.hash) {
          if (entry.readError) { announce(); throw new HttpError(409, entry.readError); }
          throw new HttpError(409, '文件仍在写入，请稍后重试。');
        }
        await identify(current, entry);
        await reconcile(entry, current);
        await persist();
        announce();
        if (entry.lookupError) throw new HttpError(502, entry.lookupError);
        return toAdmin(entry);
      });
    },
    async download(id: unknown) {
      const entry = entryOf(id);
      if (!entry.enabled || !directory || !publicSides().includes(effectiveSide(entry))) throw new HttpError(404, '该模组当前不可下载。');
      // A bound entry downloads the Modrinth file that matches the local hash, never the newest release.
      const remote = entry.bound ? entry.version?.url ?? null : entry.downloadUrl;
      if (remote) return { redirect: remote, path: null, fileName: null, size: 0 };
      if (!safeFileName(entry.fileName)) throw new HttpError(404, '该模组当前不可下载。');
      const path = modFilePath(directory, entry.location, entry.fileName, true);
      const info = await lstat(path).catch(() => null);
      if (!info?.isFile()) throw new HttpError(404, '该模组文件已不可用。');
      return { redirect: null, path, fileName: entry.fileName, size: info.size };
    },
    async close() {
      closed = true;
      generation++;
      stopWatching();
      listeners.clear();
      await queue.catch(() => undefined);
    },
  };
}
