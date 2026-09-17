import { XMLParser } from 'fast-xml-parser';
import type { Loader, VersionList, VersionOption } from '../shared/types.js';
import { HttpError } from './errors.js';

const xml = new XMLParser({ parseTagValue: false });
const CACHE_TTL = 60 * 60 * 1000;
const SOURCES = {
  minecraft: 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
  fabric: 'https://meta.fabricmc.net/v2/versions/loader/',
  quilt: 'https://meta.quiltmc.org/v3/versions/loader/',
  forge: 'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml',
  neoforge: 'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml',
};

export function mavenVersions(text: string): string[] {
  const values: unknown = xml.parse(text)?.metadata?.versioning?.versions?.version;
  return (Array.isArray(values) ? values : [values]).filter((v): v is string => typeof v === 'string');
}
export function filterMavenVersions(loader: 'forge' | 'neoforge', game: string, versions: string[]): VersionOption[] {
  const gameParts = /^1\.(\d+)(?:\.(\d+))?$/.exec(game);
  const calendarParts = /^(2\d)\.(\d+)(?:\.(\d+))?$/.exec(game);
  return versions.flatMap(version => {
    if (loader === 'forge') return version.startsWith(`${game}-`) ? [{ id: version.slice(game.length + 1) }] : [];
    // NeoForge uses <Minecraft minor>.<patch>.<build>; 1.20.1 predates this artifact.
    if (!gameParts && !calendarParts) return [];
    const prefix = gameParts ? `${gameParts[1]}.${gameParts[2] ?? '0'}.`
      : `${calendarParts![1]}.${calendarParts![2]}.${calendarParts![3] ?? '0'}.`;
    return version.startsWith(prefix) ? [{ id: version }] : [];
  }).reverse();
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
  async function get(url: string) {
    const response = await fetcher(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`Version source: ${response.status}`);
    return response;
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
      // The original NeoForge 1.20.1 builds were published under the forge artifact.
      const source = loader === 'neoforge' && game === '1.20.1'
        ? 'https://maven.neoforged.net/releases/net/neoforged/forge/maven-metadata.xml' : SOURCES[loader];
      const versions = mavenVersions(await (await get(source)).text());
      return filterMavenVersions(loader === 'neoforge' && game === '1.20.1' ? 'forge' : loader, game, versions);
    }),
  };
}
