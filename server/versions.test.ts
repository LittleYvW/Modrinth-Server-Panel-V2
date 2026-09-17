import { describe, expect, it, vi } from 'vitest';
import { createVersionService, filterMavenVersions, mavenVersions } from './versions.js';

describe('official version adapters', () => {
  it('parses Maven versions and matches old and calendar-based Minecraft versions', () => {
    expect(mavenVersions('<metadata><versioning><versions><version>1.20.1-47.1.0</version></versions></versioning></metadata>')).toEqual(['1.20.1-47.1.0']);
    expect(filterMavenVersions('forge', '1.20.1', ['1.20.1-47.1.0', '1.20.2-48.0.0'])).toEqual([{ id: '47.1.0' }]);
    expect(filterMavenVersions('neoforge', '1.21.1', ['21.1.10', '21.11.0', '21.1.20'])).toEqual([{ id: '21.1.20' }, { id: '21.1.10' }]);
    expect(filterMavenVersions('neoforge', '26.1', ['26.1.0.1-beta', '26.1.1.2', '26.2.0.3'])).toEqual([{ id: '26.1.0.1-beta', type: 'beta' }]);
    expect(filterMavenVersions('neoforge', '26.1.1', ['26.1.0.1', '26.1.1.2'])).toEqual([{ id: '26.1.1.2' }]);
  });
  it('orders builds by number, keeps pre-release builds out of release lists and matches snapshots', () => {
    // Maven metadata for the older branches is sorted as text, so 20.4.11-beta is published before 20.4.109-beta.
    expect(filterMavenVersions('neoforge', '1.20.4', ['20.4.109-beta', '20.4.11-beta', '20.4.200']))
      .toEqual([{ id: '20.4.200' }, { id: '20.4.109-beta', type: 'beta' }, { id: '20.4.11-beta', type: 'beta' }]);
    const builds = ['26.1.0.0-alpha.13+snapshot-10', '26.1.0.0-alpha.15+pre-3', '26.1.0.19-beta'];
    expect(filterMavenVersions('neoforge', '26.1', builds)).toEqual([{ id: '26.1.0.19-beta', type: 'beta' }]);
    expect(filterMavenVersions('neoforge', '26.1-snapshot-10', builds)).toEqual([{ id: '26.1.0.0-alpha.13+snapshot-10', type: 'alpha' }]);
    expect(filterMavenVersions('neoforge', '26.1-pre-3', builds)).toEqual([{ id: '26.1.0.0-alpha.15+pre-3', type: 'alpha' }]);
    expect(filterMavenVersions('neoforge', '25w14craftmine', ['0.25w14craftmine.5-beta', '21.5.0'])).toEqual([{ id: '0.25w14craftmine.5-beta', type: 'beta' }]);
    expect(filterMavenVersions('neoforge', 'not-a-version', ['21.1.5'])).toEqual([]);
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
  it('retries a reset connection but not a rejected version', async () => {
    const resets = vi.fn<typeof fetch>()
      .mockRejectedValueOnce(Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } }))
      .mockResolvedValue(new Response('<metadata><versioning><versions><version>21.1.5</version></versions></versioning></metadata>'));
    expect((await createVersionService(resets).loaders('neoforge', '1.21.1')).versions).toEqual([{ id: '21.1.5' }]);
    expect(resets).toHaveBeenCalledTimes(2);
    const missing = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 404 }));
    await expect(createVersionService(missing).loaders('fabric', '1.21.1')).rejects.toMatchObject({ status: 502 });
    expect(missing).toHaveBeenCalledTimes(1);
  });
  it('allows an actionable offline response, and adapts Fabric, Quilt and legacy NeoForge', async () => {
    const offline = createVersionService(vi.fn<typeof fetch>().mockRejectedValue(new Error('offline')));
    await expect(offline.minecraft()).rejects.toMatchObject({ status: 502 });
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async input => {
      const url = String(input);
      // One legacy build was published without the Minecraft prefix.
      if (url.includes('/net/neoforged/forge/')) return new Response('<metadata><versioning><versions><version>1.20.1-47.1.106</version><version>47.1.82</version></versions></versioning></metadata>');
      return new Response(JSON.stringify([{ loader: { version: '0.27.1' } }]));
    });
    const service = createVersionService(fetcher);
    expect((await service.loaders('fabric', '1.20.1')).versions).toEqual([{ id: '0.27.1' }]);
    expect((await service.loaders('quilt', '1.20.1')).versions).toEqual([{ id: '0.27.1' }]);
    expect((await service.loaders('neoforge', '1.20.1')).versions).toEqual([{ id: '47.1.106' }, { id: '47.1.82' }]);
  });
});
