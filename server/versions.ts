import { XMLParser } from 'fast-xml-parser';
import type { Loader, VersionList, VersionOption } from '../shared/types.js';
import { HttpError } from './errors.js';

const xml = new XMLParser({ parseTagValue: false });
const CACHE_TTL = 60 * 60 * 1000;
const ATTEMPTS = 4;
const RETRY_WINDOW = 12 * 1000;
const SOURCES = {
  minecraft: 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
  fabric: 'https://meta.fabricmc.net/v2/versions/loader/',
  quilt: 'https://meta.quiltmc.org/v3/versions/loader/',
  forge: 'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml',
  neoforge: 'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml',
  legacyNeoforge: 'https://maven.neoforged.net/releases/net/neoforged/forge/maven-metadata.xml',
};

export function mavenVersions(text: string): string[] {
  const values: unknown = xml.parse(text)?.metadata?.versioning?.versions?.version;
  return (Array.isArray(values) ? values : [values]).filter((v): v is string => typeof v === 'string');
}

// The original NeoForge builds for 1.20.1 were published under the forge artifact, in Forge's own format.
export const LEGACY_NEOFORGE_GAME = '1.20.1';

// NeoForge numbers builds `<Minecraft minor>.<patch>.<build>`, `<year>.<major>.<patch>.<build>` for calendar
// releases and `0.<snapshot>.<build>` for the old snapshot scheme. A `+snapshot-n`/`+pre-n` suffix marks a build
// for that pre-release rather than for the finished game version.
function neoforgeTarget(game: string) {
  const tagged = /^(.+?)-((?:snapshot|pre|rc)-?\d+)$/.exec(game);
  const base = tagged?.[1] ?? game;
  const tag = tagged?.[2];
  const gameParts = /^1\.(\d+)(?:\.(\d+))?$/.exec(base);
  if (gameParts) return { prefix: `${gameParts[1]}.${gameParts[2] ?? '0'}.`, tag };
  const calendarParts = /^(2\d)\.(\d+)(?:\.(\d+))?$/.exec(base);
  if (calendarParts) return { prefix: `${calendarParts[1]}.${calendarParts[2]}.${calendarParts[3] ?? '0'}.`, tag };
  if (!tag && /^\d\dw\d+[a-z0-9]*$/.test(base)) return { prefix: `0.${base}.`, tag };
  return null;
}

// Maven metadata is in publication order, which interleaves branches and is sometimes sorted as text, so order
// by the build numbers themselves and keep the newest first.
function newestFirst(options: VersionOption[]): VersionOption[] {
  const numbers = (id: string) => (id.match(/\d+/g) ?? []).map(Number);
  return options.map((option, index) => ({ option, index, key: numbers(option.id) }))
    .sort((a, b) => {
      for (let i = 0; i < Math.max(a.key.length, b.key.length); i++) {
        const difference = (b.key[i] ?? -1) - (a.key[i] ?? -1);
        if (difference) return difference;
      }
      return b.index - a.index;
    })
    .map(entry => entry.option);
}

export function filterMavenVersions(loader: 'forge' | 'neoforge', game: string, versions: string[]): VersionOption[] {
  if (loader === 'forge' || game === LEGACY_NEOFORGE_GAME) {
    return newestFirst(versions.flatMap(version => {
      if (version.startsWith(`${game}-`)) return [{ id: version.slice(game.length + 1) }];
      // One legacy NeoForge build was published without the Minecraft prefix.
      return loader === 'neoforge' && /^\d+(?:\.\d+)+$/.test(version) ? [{ id: version }] : [];
    }));
  }
  const target = neoforgeTarget(game);
  if (!target) return [];
  return newestFirst(versions.flatMap(version => {
    if (!version.startsWith(target.prefix)) return [];
    const preRelease = /\+(.+)$/.exec(version)?.[1];
    if (target.tag ? preRelease !== target.tag : preRelease !== undefined) return [];
    const stability = /-(alpha|beta)/.exec(version)?.[1];
    return [stability ? { id: version, type: stability } : { id: version }];
  }));
}

export function createVersionService(fetcher: typeof fetch = fetch) {
  const cache = new Map<string, { data: VersionOption[]; time: number }>();
  const pending = new Map<string, Promise<VersionList>>();
  async function retrieve(key: string, load: () => Promise<VersionOption[]>): Promise<VersionList> {
    const existing = cache.get(key);
    if (existing && Date.now() - existing.time < CACHE_TTL) return { versions: existing.data };
    const inFlight = pending.get(key);
    if (inFlight) return inFlight;
    const operation = (async () => {
      try {
        const data = await load();
        if (cache.size >= 100) cache.delete(cache.keys().next().value!);
        cache.set(key, { data, time: Date.now() });
        return { versions: data };
      } catch {
        if (existing) return { versions: existing.data, stale: true };
        throw new HttpError(502, '暂时无法获取在线版本，请重试或手动输入版本号。');
      } finally { pending.delete(key); }
    })();
    pending.set(key, operation);
    return operation;
  }
  // Some mirrors reset connections intermittently, so retry briefly rather than reporting a transient reset as an
  // outage. The deadline keeps a hung source from stacking full timeouts on top of each other.
  async function get(url: string) {
    const deadline = Date.now() + RETRY_WINDOW;
    for (let attempt = 1; ; attempt++) {
      const canRetry = attempt < ATTEMPTS && Date.now() < deadline;
      let response: Response;
      try {
        response = await fetcher(url, { signal: AbortSignal.timeout(8000) });
      } catch (error) {
        if (!canRetry) throw error;
        continue;
      }
      if (response.ok) return response;
      // A version the source does not publish will not appear on a retry; an upstream fault might clear.
      if (response.status < 500 || !canRetry) throw new Error(`Version source: ${response.status}`);
    }
  }
  return {
    minecraft: () => retrieve('minecraft', async () => {
      const data = await (await get(SOURCES.minecraft)).json() as { versions: { id: string; type: string }[] };
      return data.versions.filter(v => v.type === 'release' || v.type === 'snapshot').map(v => ({ id: v.id, type: v.type }));
    }),
    loaders: (loader: Loader, game: string) => retrieve(`${loader}:${game}`, async () => {
      if (loader === 'fabric' || loader === 'quilt') {
        const response = await get(SOURCES[loader] + encodeURIComponent(game));
        const data = await response.json() as { loader: { version: string } }[];
        return data.map(v => ({ id: v.loader.version }));
      }
      const source = loader === 'neoforge' && game === LEGACY_NEOFORGE_GAME ? SOURCES.legacyNeoforge : SOURCES[loader];
      return filterMavenVersions(loader, game, mavenVersions(await (await get(source)).text()));
    }),
  };
}
