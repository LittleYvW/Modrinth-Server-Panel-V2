// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import DownloadCard from './DownloadCard';
import { fileNameOf } from './downloads';
import ModDownload from './ModDownload';
import { PublicMods } from './Mods';
import { useDownloadHandles } from './useDownloadHandles';
import { api } from './api';
import type { DownloadFile } from './downloads';

vi.mock('./api', async original => ({ ...await original<typeof import('./api')>(), api: vi.fn() }));

type Stream = { push(bytes: number): void; end(): void };
type Request = { url: string; signal: AbortSignal; fail(): void; respond(init?: { status?: number; headers?: Record<string, string>; url?: string }): Stream };
let requests: Request[];
let saves: { href: string; name: string }[];
let blobs: number;
beforeEach(() => {
  vi.useFakeTimers();
  requests = [];
  saves = [];
  blobs = 0;
  vi.mocked(api).mockReset();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    expect(this).toBeInTheDocument();
    saves.push({ href: this.getAttribute('href')!, name: this.download });
  });
  Object.assign(URL, { createObjectURL: vi.fn(() => `blob:${++blobs}`), revokeObjectURL: vi.fn() });
  vi.stubGlobal('fetch', vi.fn((url: string, { signal }: { signal: AbortSignal }) => new Promise<Response>((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    requests.push({
      url, signal,
      fail: () => reject(new TypeError('Failed to fetch')),
      respond({ status = 200, headers = {}, url: finalUrl } = {}) {
        let controller!: ReadableStreamDefaultController<Uint8Array>;
        const body = new ReadableStream<Uint8Array>({ start: c => { controller = c; } });
        signal.addEventListener('abort', () => { try { controller.error(new DOMException('aborted', 'AbortError')); } catch { /* closed */ } });
        const res = new Response(body, { status, headers });
        if (finalUrl) Object.defineProperty(res, 'url', { value: finalUrl });
        resolve(res);
        return { push: bytes => controller.enqueue(new Uint8Array(bytes)), end: () => controller.close() };
      },
    });
  })));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const button = () => document.querySelector<HTMLButtonElement>('.download-card')!;
const files = (...urls: string[]) => urls.map(url => ({ url, name: `${url.slice(1)}.jar` }));
const row = (url: string) => document.querySelector<HTMLAnchorElement>(`.mod-download[href="${url}"]`)!;
// Mirrors how PublicMods wires the card to the rows it drives.
function Batch({ list, active = true, loading = false, error = '' }: {
  list: DownloadFile[]; active?: boolean; loading?: boolean; error?: string;
}) {
  const { register, handleOf } = useDownloadHandles();
  return <>
    <DownloadCard files={list} loading={loading} error={error} active={active} handleOf={handleOf} />
    {list.map(file => <ModDownload key={file.url} file={file} label={file.name} active={active} register={register} />)}
  </>;
}
const card = (list = files('/one', '/two', '/three'), active = true) => <Batch list={list} active={active} />;
const advance = async (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const jar = (name: string, size: number) => ({ headers: { 'Content-Length': String(size), 'Content-Disposition': `attachment; filename="x.jar"; filename*=UTF-8''${encodeURIComponent(name)}` } });

describe('batch downloads', () => {
  it('drives the row itself, reporting connecting, byte progress and completion', async () => {
    render(card(files('/one')));
    expect(button()).toHaveAttribute('data-phase', 'idle');
    fireEvent.click(button());
    expect(button()).toHaveAttribute('data-phase', 'connecting');
    expect(button()).toHaveTextContent('正在连接');
    expect(button()).toBeDisabled();
    expect(row('/one')).toHaveAttribute('data-phase', 'connecting');

    const stream = requests[0].respond(jar('钠 sodium.jar', 100));
    await advance(0);
    expect(button()).toHaveAttribute('data-phase', 'downloading');
    expect(row('/one')).toHaveAttribute('data-phase', 'downloading');
    stream.push(40);
    await advance(20);
    expect(button()).toHaveTextContent('40%');
    expect(button().style.getPropertyValue('--progress')).toBe('0.4');
    expect(row('/one').style.getPropertyValue('--progress')).toBe('0.4');
    expect(saves).toEqual([]);

    stream.push(60);
    stream.end();
    await advance(20);
    expect(saves).toEqual([{ href: 'blob:1', name: '钠 sodium.jar' }]);
    expect(button()).toHaveAttribute('data-phase', 'done');
    expect(button()).toBeEnabled();
    expect(row('/one')).toHaveAttribute('data-phase', 'done');
    expect(screen.getByRole('status')).toHaveTextContent('已下载 1 个模组。');
    expect(document.querySelector('a[download]')).toBeNull();
    await advance(2500);
    expect(button()).toHaveAttribute('data-phase', 'idle');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await advance(60_000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:1');
  });

  it('starts one row at a time, spaced, and ignores clicks while running', async () => {
    render(card(files('/a', '/b', '/c')));
    fireEvent.click(button());
    fireEvent.click(button());
    expect(requests.map(request => request.url)).toEqual(['/a']);
    requests[0].respond().end();
    await advance(0);
    expect(saves.map(save => save.name)).toEqual(['a.jar']);
    await advance(299);
    expect(requests).toHaveLength(1);
    await advance(1);
    expect(requests.map(request => request.url)).toEqual(['/a', '/b']);
    requests[1].respond().end();
    await advance(300);
    expect(requests.map(request => request.url)).toEqual(['/a', '/b', '/c']);
    requests[2].respond().end();
    await advance(300);
    expect(saves.map(save => save.name)).toEqual(['a.jar', 'b.jar', 'c.jar']);
    expect(button()).toHaveAttribute('data-phase', 'done');
  });

  it('keeps the queue it was clicked with and fails mods whose row has gone', async () => {
    const view = render(card(files('/a', '/b')));
    fireEvent.click(button());
    requests[0].respond().end();
    await advance(0);
    view.rerender(card(files('/a')));
    await advance(1000);
    expect(requests.map(request => request.url)).toEqual(['/a']);
    expect(button()).toHaveTextContent('部分失败');
    expect(screen.getByRole('status')).toHaveTextContent('1 个模组下载失败，其余 1 个已保存。');
  });

  it('counts failed responses and hands requests that cannot be fetched to the browser', async () => {
    render(card(files('/missing', '/mirror', '/ok')));
    fireEvent.click(button());
    requests[0].respond({ status: 404 });
    await advance(300);
    expect(row('/missing')).toHaveAttribute('data-phase', 'failed');
    requests[1].fail();
    await advance(300);
    requests[2].respond({ url: 'https://cdn.modrinth.com/data/x/sodium-fabric-0.6%2Bmc1.21.jar' }).end();
    await advance(300);
    expect(saves).toEqual([{ href: '/mirror', name: '' }, { href: 'blob:1', name: 'sodium-fabric-0.6+mc1.21.jar' }]);
    expect(button()).toHaveTextContent('部分失败');
    expect(screen.getByRole('status')).toHaveTextContent('1 个模组下载失败，其余 2 个已保存。');
  });

  it('leaves the connecting phase when every request is handed to the browser', async () => {
    render(card(files('/mirror-one', '/mirror-two')));
    fireEvent.click(button());
    expect(button()).toHaveAttribute('data-phase', 'connecting');
    requests[0].fail();
    await advance(0);
    expect(button()).toHaveAttribute('data-phase', 'downloading');
    await advance(300);
    requests[1].fail();
    await advance(300);
    expect(saves).toEqual([{ href: '/mirror-one', name: '' }, { href: '/mirror-two', name: '' }]);
    expect(button()).toHaveTextContent('下载完成');
  });

  it('counts a refused save as a failure, cleans up and moves on', async () => {
    vi.mocked(HTMLAnchorElement.prototype.click).mockImplementationOnce(() => { throw new Error('blocked'); });
    render(card(files('/a', '/b')));
    fireEvent.click(button());
    requests[0].respond().end();
    await advance(300);
    expect(row('/a')).toHaveAttribute('data-phase', 'failed');
    requests[1].respond().end();
    await advance(300);
    expect(saves).toEqual([{ href: 'blob:2', name: 'b.jar' }]);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:1');
    expect(document.querySelector('a[download]')).toBeNull();
    expect(button()).toHaveTextContent('部分失败');
    expect(screen.getByRole('status')).toHaveTextContent('1 个模组下载失败，其余 1 个已保存。');
  });

  it.each(['inactive', 'unmount', 'pagehide'])('aborts the running row and stops the queue on %s', async reason => {
    const view = render(card());
    fireEvent.click(button());
    requests[0].respond().push(10);
    await advance(0);
    if (reason === 'inactive') view.rerender(card(undefined, false));
    else if (reason === 'unmount') view.unmount();
    else fireEvent(window, new Event('pagehide'));
    await advance(1000);
    expect(requests).toHaveLength(1);
    expect(requests[0].signal.aborted).toBe(true);
    expect(saves).toEqual([]);
    if (reason === 'inactive') {
      view.rerender(card());
      expect(button()).toHaveAttribute('data-phase', 'idle');
      expect(button()).toBeEnabled();
      expect(row('/one')).toHaveAttribute('data-phase', 'idle');
    }
  });

  it.each([
    { loading: true, error: '', urls: ['/one'], message: '正在读取模组列表…' },
    { loading: false, error: '网络错误', urls: ['/one'], message: '模组列表加载失败：网络错误' },
    { loading: false, error: '', urls: [], message: '暂无可下载的双端模组。' },
  ])('disables unavailable downloads: $message', ({ message, urls, ...props }) => {
    render(<Batch list={files(...urls)} {...props} />);
    expect(button()).toBeDisabled();
    expect(button()).toHaveAccessibleDescription(message);
    expect(screen.getByText('需要多重下载权限')).toBeInTheDocument();
    fireEvent.click(button());
    expect(requests).toEqual([]);
  });

  it('shares the live list and drives only both-side rows, using encoded IDs', async () => {
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
    expect(requests.map(request => request.url)).toEqual(['/api/public/mods/mod%200/download']);
    requests[0].respond().end();
    await advance(300);
    expect(requests.map(request => request.url)).toEqual(['/api/public/mods/mod%200/download', '/api/public/mods/mod%203/download']);
    requests[1].respond().end();
    await advance(300);
    expect(saves.map(save => save.name)).toEqual(['Mod 0.jar', 'Mod 3.jar']);
    expect(button()).toHaveAttribute('data-phase', 'done');

    await act(async () => { update!(); });
    expect(screen.queryByText('Mod 0')).not.toBeInTheDocument();
    fireEvent.click(button());
    expect(requests.at(-1)!.url).toBe('/api/public/mods/mod%203/download');
    expect(vi.mocked(api)).toHaveBeenCalledTimes(2);
  });
});

describe('single mod download', () => {
  const file = { url: '/api/public/mods/a/download', name: 'Sodium.jar' };
  const link = () => screen.getByRole('link');
  const mod = (active = true) => <ModDownload file={file} label="Sodium" active={active} />;

  it('animates connecting, progress and completion, then saves the blob', async () => {
    render(mod());
    expect(link()).toHaveAttribute('href', file.url);
    expect(link()).toHaveAttribute('data-phase', 'idle');
    expect(fireEvent.click(link())).toBe(false);
    fireEvent.click(link());
    expect(requests).toHaveLength(1);
    expect(link()).toHaveAttribute('data-phase', 'connecting');
    expect(link()).toHaveAttribute('aria-busy', 'true');
    expect(link().querySelector('.mod-download-ring')).toBeInTheDocument();

    const stream = requests[0].respond(jar('sodium-0.6.jar', 100));
    await advance(0);
    expect(link()).toHaveAttribute('data-phase', 'downloading');
    stream.push(50);
    await advance(20);
    expect(link().style.getPropertyValue('--progress')).toBe('0.5');
    stream.push(50);
    stream.end();
    await advance(20);
    expect(saves).toEqual([{ href: 'blob:1', name: 'sodium-0.6.jar' }]);
    expect(link()).toHaveAttribute('data-phase', 'done');
    expect(link()).not.toHaveAttribute('aria-busy');
    expect(link().querySelector('.mod-download-ring')).toBeNull();
    await advance(1500);
    expect(link()).toHaveAttribute('data-phase', 'idle');
  });

  it('shows failures and lets the user retry', async () => {
    render(mod());
    fireEvent.click(link());
    requests[0].respond({ status: 404 });
    await advance(0);
    expect(link()).toHaveAttribute('data-phase', 'failed');
    expect(link()).toHaveAccessibleName('Sodium 下载失败，点击重试');
    expect(saves).toEqual([]);
    fireEvent.click(link());
    expect(requests).toHaveLength(2);
    expect(link()).toHaveAttribute('data-phase', 'connecting');
    requests[1].respond().end();
    await advance(0);
    expect(saves).toEqual([{ href: 'blob:1', name: 'Sodium.jar' }]);
  });

  it('leaves modified clicks to the browser', () => {
    render(mod());
    for (const modifier of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey']) expect(fireEvent.click(link(), { [modifier]: true })).toBe(true);
    expect(fireEvent.click(link(), { button: 1 })).toBe(true);
    expect(requests).toEqual([]);
  });

  it.each(['inactive', 'unmount', 'pagehide'])('aborts on %s', async reason => {
    const view = render(mod());
    fireEvent.click(link());
    requests[0].respond().push(10);
    if (reason === 'inactive') view.rerender(mod(false));
    else if (reason === 'unmount') view.unmount();
    else fireEvent(window, new Event('pagehide'));
    await advance(100);
    expect(requests[0].signal.aborted).toBe(true);
    expect(saves).toEqual([]);
    if (reason !== 'unmount') expect(link()).toHaveAttribute('data-phase', 'idle');
  });

  it('is wired into every public mod row', async () => {
    vi.stubGlobal('EventSource', class { addEventListener() {} close() {} });
    vi.mocked(api).mockResolvedValueOnce({ revision: 1, mods: [
      { id: 'mod 1', name: 'Mod 1', side: 'server', description: '', version: '', iconUrl: null, projectUrl: null },
    ] });
    await act(async () => { render(<PublicMods />); });
    fireEvent.click(screen.getByRole('link', { name: '下载 Mod 1' }));
    expect(requests.map(request => request.url)).toEqual(['/api/public/mods/mod%201/download']);
    requests[0].respond().end();
    await advance(0);
    expect(saves).toEqual([{ href: 'blob:1', name: 'Mod 1.jar' }]);
  });
});

describe('fileNameOf', () => {
  const response = (headers: Record<string, string>, url = '') => {
    const res = new Response(null, { headers });
    if (url) Object.defineProperty(res, 'url', { value: url });
    return res;
  };
  it('prefers the encoded header, then the plain one, then a .jar URL segment', () => {
    expect(fileNameOf(response({ 'Content-Disposition': `attachment; filename="a.jar"; filename*=UTF-8''%E9%92%A0.jar` }), 'f.jar')).toBe('钠.jar');
    expect(fileNameOf(response({ 'Content-Disposition': 'attachment; filename="a.jar"' }), 'f.jar')).toBe('a.jar');
    expect(fileNameOf(response({}, 'https://cdn.test/x/b%2B1.jar'), 'f.jar')).toBe('b+1.jar');
    expect(fileNameOf(response({}, 'http://panel.test/api/public/mods/x/download'), 'f.jar')).toBe('f.jar');
    expect(fileNameOf(response({ 'Content-Disposition': `attachment; filename*=UTF-8''%E0.jar` }), 'f.jar')).toBe('f.jar');
  });
});
