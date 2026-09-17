import { describe, expect, it, vi } from 'vitest';
import { createVersionService, filterMavenVersions, mavenVersions } from './versions.js';

describe('official version adapters', () => {
  it('parses Maven versions and matches old and calendar-based Minecraft versions', () => {
    expect(mavenVersions('<metadata><versioning><versions><version>1.20.1-47.1.0</version></versions></versioning></metadata>')).toEqual(['1.20.1-47.1.0']);
    expect(filterMavenVersions('forge', '1.20.1', ['1.20.1-47.1.0', '1.20.2-48.0.0'])).toEqual([{ id: '47.1.0' }]);
    expect(filterMavenVersions('neoforge', '1.21.1', ['21.1.10', '21.11.0', '21.1.20'])).toEqual([{ id: '21.1.20' }, { id: '21.1.10' }]);
    expect(filterMavenVersions('neoforge', '26.1', ['26.1.0.1-beta', '26.1.1.2', '26.2.0.3'])).toEqual([{ id: '26.1.0.1-beta' }]);
    expect(filterMavenVersions('neoforge', '26.1.1', ['26.1.0.1', '26.1.1.2'])).toEqual([{ id: '26.1.1.2' }]);
  });
  it('caches successful responses and serves stale lists when upstream is unavailable', async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ versions: [{ id: '1.20.1', type: 'release' }] })));
      const service = createVersionService(fetcher);
      const first = await service.minecraft(); await service.minecraft();
      expect(fetcher).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(3_600_001); fetcher.mockRejectedValue(new Error('offline'));
      expect(await service.minecraft()).toEqual({ ...first, stale: true });
    } finally { vi.useRealTimers(); }
  });
  it('allows an actionable offline response, and adapts Fabric, Quilt and legacy NeoForge', async () => {
    const offline = createVersionService(vi.fn<typeof fetch>().mockRejectedValue(new Error('offline')));
    await expect(offline.minecraft()).rejects.toMatchObject({ status: 502 });
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async input => {
      const url = String(input);
      if (url.includes('/net/neoforged/forge/')) return new Response('<metadata><versioning><versions><version>1.20.1-47.1.106</version></versions></versioning></metadata>');
      return new Response(JSON.stringify([{ loader: { version: '0.27.1' } }]));
    });
    const service = createVersionService(fetcher);
    expect((await service.loaders('fabric', '1.20.1')).versions).toEqual([{ id: '0.27.1' }]);
    expect((await service.loaders('quilt', '1.20.1')).versions).toEqual([{ id: '0.27.1' }]);
    expect((await service.loaders('neoforge', '1.20.1')).versions).toEqual([{ id: '47.1.106' }]);
  });
});
