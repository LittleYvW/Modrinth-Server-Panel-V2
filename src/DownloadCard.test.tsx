// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import DownloadCard from './DownloadCard';
import { PublicMods } from './Mods';
import { api } from './api';

vi.mock('./api', async original => ({ ...await original<typeof import('./api')>(), api: vi.fn() }));
let downloads: string[];
beforeEach(() => {
  vi.useFakeTimers();
  downloads = [];
  vi.mocked(api).mockReset();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    expect(this).toHaveAttribute('download', '');
    expect(this).toBeInTheDocument();
    downloads.push(this.getAttribute('href')!);
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const button = () => screen.getByRole('button', { name: /下载全部\s*需要多重下载权限/ });
const card = (urls = ['/one', '/two', '/three'], active = true) => <DownloadCard urls={urls} loading={false} error="" active={active} />;
const advance = async (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe('batch downloads', () => {
  it('snapshots the queue, spaces requests, prevents duplicate clicks and cleans up links', async () => {
    const view = render(card());
    fireEvent.click(button());
    fireEvent.click(button());
    expect(downloads).toEqual(['/one']);
    expect(button()).toBeDisabled();
    view.rerender(card(['/replacement']));
    await advance(299);
    expect(downloads).toHaveLength(1);
    await advance(1);
    expect(downloads).toEqual(['/one', '/two']);
    await advance(300);
    expect(downloads).toEqual(['/one', '/two', '/three']);
    expect(button()).toBeEnabled();
    expect(document.querySelector('a[download]')).toBeNull();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(button());
    expect(downloads.at(-1)).toBe('/replacement');
  });

  it.each(['inactive', 'unmount', 'pagehide'])('cancels pending downloads on %s', async reason => {
    const view = render(card());
    fireEvent.click(button());
    if (reason === 'inactive') view.rerender(card(undefined, false));
    else if (reason === 'unmount') view.unmount();
    else fireEvent(window, new Event('pagehide'));
    await advance(1000);
    expect(downloads).toEqual(['/one']);
    if (reason === 'inactive') {
      view.rerender(card());
      expect(button()).toBeEnabled();
    }
  });

  it.each([
    { loading: true, error: '', urls: ['/one'], message: '正在读取模组列表…' },
    { loading: false, error: '网络错误', urls: ['/one'], message: '模组列表加载失败：网络错误' },
    { loading: false, error: '', urls: [], message: '暂无可下载的双端模组。' },
  ])('disables unavailable downloads: $message', ({ message, ...props }) => {
    render(<DownloadCard {...props} active />);
    expect(button()).toBeDisabled();
    expect(button()).toHaveAccessibleDescription(message);
    expect(screen.getByText('需要多重下载权限')).toBeInTheDocument();
    fireEvent.click(button());
    expect(downloads).toEqual([]);
  });

  it('shares the live list and downloads only both-side entries, using encoded IDs', async () => {
    let update: (() => void) | undefined;
    vi.stubGlobal('EventSource', class {
      addEventListener(_name: string, handler: () => void) { update = handler; }
      close() {}
    });
    const mods = ['both', 'server', 'client', 'both'].map((side, index) => ({
      id: `mod ${index}`, name: `Mod ${index}`, side, description: '', version: '', iconUrl: null, projectUrl: null,
    }));
    vi.mocked(api).mockResolvedValueOnce({ revision: 1, mods })
      .mockResolvedValueOnce({ revision: 2, mods: [mods[3]] });
    await act(async () => { render(<PublicMods />); });
    fireEvent.click(button());
    await act(async () => { update!(); });
    expect(screen.queryByText('Mod 0')).not.toBeInTheDocument();
    await advance(300);
    expect(downloads).toEqual(['/api/public/mods/mod%200/download', '/api/public/mods/mod%203/download']);
    fireEvent.click(button());
    expect(downloads.at(-1)).toBe('/api/public/mods/mod%203/download');
    expect(vi.mocked(api)).toHaveBeenCalledTimes(2);
  });
});
