import type { ModCategorySource, ModSide } from '../shared/types.js';

const API = 'https://api.modrinth.com/v2';
const AGENT = 'server-mods-panel/1.0 (self-hosted Minecraft mods panel)';
const TIMEOUT = 15 * 1000;
const ATTEMPTS = 3;
const MAX_BACKOFF = 30 * 1000;
export const HASH_BATCH = 100;
export const PROJECT_BATCH = 100;

export type ModrinthFile = { hashes?: { sha512?: string }; url?: string; filename?: string; primary?: boolean };
export type ModrinthVersion = {
  id: string; project_id: string; name?: string; version_number?: string;
  environment?: unknown; files?: ModrinthFile[];
};
export type ModrinthProject = {
  id: string; slug?: string; title?: string; description?: string; icon_url?: string | null;
  project_type?: string; client_side?: string; server_side?: string; environment?: unknown;
};

// A lookup that reached Modrinth and simply found nothing is a miss, not a failure; only transport and
// server faults become ModrinthError so that a miss is never mistaken for an outage.
export class ModrinthError extends Error {}

// https://docs.modrinth.com/api/operations/getproject/ — the required side decides the category.
const ENVIRONMENT_SIDES: Record<string, ModSide> = {
  client_only: 'client', client_only_server_optional: 'client', singleplayer_only: 'client',
  server_only: 'server', server_only_client_optional: 'server', dedicated_server_only: 'server',
  client_and_server: 'both', client_or_server: 'both', client_or_server_prefers_both: 'both',
};

export function environmentSide(value: unknown): ModSide | null {
  return typeof value === 'string' ? ENVIRONMENT_SIDES[value] ?? null : null;
}

// A project may publish several environments; spanning more than one category means both sides are served.
export function projectEnvironmentSide(value: unknown): ModSide | null {
  const values = Array.isArray(value) ? value : [value];
  const sides = new Set(values.map(environmentSide).filter((side): side is ModSide => !!side));
  if (!sides.size) return null;
  return sides.size === 1 ? [...sides][0] : 'both';
}

// The pre-environment fields: one required side wins, and an unsupported side hands the category to the other.
export function legacySide(project: ModrinthProject): ModSide | null {
  const supported = (value: unknown) => value === 'required' || value === 'optional';
  const client = project.client_side;
  const server = project.server_side;
  if (client === 'required' && server !== 'required') return 'client';
  if (server === 'required' && client !== 'required') return 'server';
  if (client === 'unsupported' && supported(server)) return 'server';
  if (server === 'unsupported' && supported(client)) return 'client';
  return null;
}

export function classify(version: ModrinthVersion | null, project: ModrinthProject | null): { side: ModSide; source: ModCategorySource } | null {
  const fromVersion = version ? environmentSide(version.environment) : null;
  if (fromVersion) return { side: fromVersion, source: 'version-environment' };
  if (!project) return null;
  const fromProject = projectEnvironmentSide(project.environment);
  if (fromProject) return { side: fromProject, source: 'project-environment' };
  const legacy = legacySide(project);
  if (legacy) return { side: legacy, source: 'legacy-fields' };
  return { side: 'both', source: 'default' };
}

export function versionFileUrl(version: ModrinthVersion, hash: string): string | null {
  const match = version.files?.find(file => file.hashes?.sha512?.toLowerCase() === hash.toLowerCase());
  return typeof match?.url === 'string' ? match.url : null;
}

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export function createModrinth(fetcher: typeof fetch = fetch) {
  async function send(path: string, init?: RequestInit): Promise<unknown> {
    for (let attempt = 1; ; attempt++) {
      const last = attempt >= ATTEMPTS;
      let response: Response;
      try {
        response = await fetcher(`${API}${path}`, {
          ...init,
          headers: { 'User-Agent': AGENT, Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
          signal: AbortSignal.timeout(TIMEOUT),
        });
      } catch {
        if (last) throw new ModrinthError('无法连接 Modrinth，请检查网络后重试。');
        await wait(Math.min(500 * 2 ** attempt, MAX_BACKOFF));
        continue;
      }
      if (response.ok) {
        try { return await response.json(); }
        catch { throw new ModrinthError('Modrinth 返回的数据无法解析。'); }
      }
      if (response.status === 404) return null;
      if ((response.status === 429 || response.status >= 500) && !last) {
        const retryAfter = Number(response.headers.get('retry-after'));
        await wait(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, MAX_BACKOFF) : Math.min(500 * 2 ** attempt, MAX_BACKOFF));
        continue;
      }
      throw new ModrinthError(response.status === 429 ? 'Modrinth 请求过于频繁，请稍后重试。' : `Modrinth 暂时不可用（${response.status}）。`);
    }
  }
  return {
    // https://docs.modrinth.com/api/operations/versionsfromhashes/
    async versionsByHash(hashes: string[]): Promise<Map<string, ModrinthVersion>> {
      const found = new Map<string, ModrinthVersion>();
      const unique = [...new Set(hashes.map(hash => hash.toLowerCase()))];
      for (let index = 0; index < unique.length; index += HASH_BATCH) {
        const batch = unique.slice(index, index + HASH_BATCH);
        const data = await send('/version_files', { method: 'POST', body: JSON.stringify({ hashes: batch, algorithm: 'sha512' }) });
        for (const [hash, version] of Object.entries((data ?? {}) as Record<string, ModrinthVersion>)) {
          if (version && typeof version.id === 'string' && typeof version.project_id === 'string') found.set(hash.toLowerCase(), version);
        }
      }
      return found;
    },
    async projects(ids: string[]): Promise<Map<string, ModrinthProject>> {
      const found = new Map<string, ModrinthProject>();
      const unique = [...new Set(ids)];
      for (let index = 0; index < unique.length; index += PROJECT_BATCH) {
        const batch = unique.slice(index, index + PROJECT_BATCH);
        const data = await send(`/projects?ids=${encodeURIComponent(JSON.stringify(batch))}`);
        for (const project of (Array.isArray(data) ? data : []) as ModrinthProject[]) {
          if (project && typeof project.id === 'string') found.set(project.id, project);
        }
      }
      return found;
    },
    async project(idOrSlug: string): Promise<ModrinthProject | null> {
      const data = await send(`/project/${encodeURIComponent(idOrSlug)}`) as ModrinthProject | null;
      return data && typeof data.id === 'string' ? data : null;
    },
  };
}
export type Modrinth = ReturnType<typeof createModrinth>;
