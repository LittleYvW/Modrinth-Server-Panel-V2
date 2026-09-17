// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { AdminMods, PublicMods } from './Mods';
import { api } from './api';
import type { AdminMod, PublicMod } from '../shared/types';

vi.mock('./api', async original => ({ ...await original<typeof import('./api')>(), api: vi.fn() }));
const mocked = vi.mocked(api);

const publicMod = (overrides: Partial<PublicMod> = {}): PublicMod => ({
  id: 'a', name: 'Sodium', description: '现代渲染引擎。', version: '0.5.3',
  iconUrl: 'https://cdn.test/a.png', projectUrl: 'https://modrinth.com/mod/sodium', side: 'client', ...overrides,
});
const adminMod = (overrides: Partial<AdminMod> = {}): AdminMod => ({
  ...publicMod(), fileName: 'sodium.jar', enabled: true, categorySource: 'version-environment',
  manualSide: null, binding: 'bound', projectId: 'p1', downloadUrl: null, resolving: false, error: null, ...overrides,
});
const listen = (handlers: { mods?: () => void }) => class {
  constructor() { /* One instance per subscription. */ }
  addEventListener(name: string, handler: () => void) { if (name === 'mods') handlers.mods = handler; }
  close() { handlers.mods = undefined; }
};

beforeEach(() => {
  mocked.mockReset();
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.open = false; } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const panel = (name: string) => screen.getByRole('region', { name: new RegExp(name) });

describe('public mod list', () => {
  it('always shows the three categories and falls back for unidentified files', async () => {
    mocked.mockResolvedValue({ revision: 1, mods: [publicMod(), publicMod({ id: 'b', name: 'mystery', description: '', version: '', iconUrl: null, projectUrl: null, side: 'both' })] });
    render(<PublicMods />);
    await screen.findByText('Sodium');
    expect(screen.getAllByRole('region').map(section => section.querySelector('h2')!.textContent)).toEqual(['双端', '服务端', '客户端']);
    expect(within(panel('客户端')).getByRole('link', { name: '下载 Sodium' })).toHaveAttribute('href', '/api/public/mods/a/download');
    expect(within(panel('双端')).getByText('未在 Modrinth 上识别到该模组，使用文件名显示。')).toBeInTheDocument();
    expect(within(panel('双端')).getByText('—')).toBeInTheDocument();
    expect(within(panel('服务端')).getByText('该分类暂无已开启的模组。')).toBeInTheDocument();
  });

  it('falls back to the default icon when a remote icon fails to load', async () => {
    mocked.mockResolvedValue({ revision: 1, mods: [publicMod()] });
    const view = render(<PublicMods />);
    await screen.findByText('Sodium');
    fireEvent.error(view.container.querySelector('.mod-icon img')!);
    expect(view.container.querySelector('.mod-icon img')).toBeNull();
    expect(view.container.querySelector('.mod-icon svg')).toBeInTheDocument();
  });

  it('refetches the whole list when the revision stream reports a change', async () => {
    const handlers: { mods?: () => void } = {};
    vi.stubGlobal('EventSource', listen(handlers));
    mocked.mockResolvedValueOnce({ revision: 1, mods: [publicMod()] })
      .mockResolvedValueOnce({ revision: 2, mods: [publicMod({ id: 'b', name: 'Lithium', side: 'server' })] });
    render(<PublicMods />);
    await screen.findByText('Sodium');
    await act(async () => { handlers.mods!(); });
    expect(await screen.findByText('Lithium')).toBeInTheDocument();
    expect(screen.queryByText('Sodium')).not.toBeInTheDocument();
    expect(mocked.mock.calls.filter(([path]) => path === '/public/mods')).toHaveLength(2);
  });

  it('reports a failed list without hiding the categories', async () => {
    mocked.mockRejectedValue(new Error('无法连接服务。'));
    render(<PublicMods />);
    expect(await screen.findAllByText('无法连接服务。')).toHaveLength(3);
  });
});

describe('workspace mod management', () => {
  function load(mods: AdminMod[]) {
    mocked.mockImplementation(async path => path === '/admin/mods' ? { revision: 1, mods, scanning: false, configured: true } : { revision: 1, mods });
  }

  it('switches a mod without touching its category, binding or configuration', async () => {
    load([adminMod()]);
    const user = userEvent.setup();
    render(<AdminMods notify={vi.fn()} />);
    const toggle = await screen.findByRole('switch', { name: '启用 Sodium' });
    expect(toggle).toBeChecked();
    mocked.mockResolvedValueOnce(adminMod({ enabled: false }));
    await user.click(toggle);
    expect(mocked.mock.calls.at(-1)).toEqual(['/admin/mods/a', { method: 'PATCH', body: JSON.stringify({ enabled: false }) }]);
    await waitFor(() => expect(screen.getByRole('switch', { name: '启用 Sodium' })).not.toBeChecked());
    expect(screen.getByLabelText('分类 Sodium')).toHaveValue('auto');
    expect(screen.getByText('已绑定 Modrinth')).toBeInTheDocument();
    expect(document.querySelector('.mod-row')).toHaveClass('mod-closed');
  });

  it('sends only the category and keeps the switch when a category is chosen by hand', async () => {
    load([adminMod({ side: 'both', categorySource: 'default', binding: 'unbound', projectId: null })]);
    const user = userEvent.setup();
    render(<AdminMods notify={vi.fn()} />);
    const select = await screen.findByLabelText('分类 Sodium');
    mocked.mockResolvedValueOnce(adminMod({ side: 'server', manualSide: 'server', categorySource: 'manual', binding: 'unbound', projectId: null }));
    await user.selectOptions(select, '服务端');
    expect(mocked.mock.calls.at(-1)).toEqual(['/admin/mods/a', { method: 'PATCH', body: JSON.stringify({ side: 'server' }) }]);
    await waitFor(() => expect(screen.getByText('手动指定')).toBeInTheDocument());
    expect(screen.getByRole('switch', { name: '启用 Sodium' })).toBeChecked();
    expect(within(panel('服务端')).getByText('Sodium')).toBeInTheDocument();
  });

  it('opens manual configuration only after unbinding, and saves both fields together', async () => {
    load([adminMod()]);
    const user = userEvent.setup();
    const notify = vi.fn();
    render(<AdminMods notify={notify} />);
    expect(await screen.findByRole('button', { name: '配置 Sodium' })).toBeDisabled();
    mocked.mockResolvedValueOnce(adminMod({ binding: 'unbound', version: '' }));
    await user.click(screen.getByRole('button', { name: '取消绑定 Sodium' }));
    expect(mocked.mock.calls.at(-1)).toEqual(['/admin/mods/a/unbind', { method: 'POST', body: '{}' }]);
    await waitFor(() => expect(screen.getByRole('button', { name: '配置 Sodium' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: '配置 Sodium' }));
    await user.clear(screen.getByLabelText(/Modrinth 项目 ID/));
    await user.type(screen.getByLabelText(/Modrinth 项目 ID/), 'sodium');
    await user.type(screen.getByLabelText(/下载地址/), 'https://mirror.test/a.jar');
    mocked.mockResolvedValueOnce(adminMod({ binding: 'unbound', projectId: 'sodium', downloadUrl: 'https://mirror.test/a.jar' }));
    await user.click(screen.getByRole('button', { name: '保存配置' }));
    expect(mocked.mock.calls.at(-1)).toEqual(['/admin/mods/a', { method: 'PATCH', body: JSON.stringify({ projectId: 'sodium', downloadUrl: 'https://mirror.test/a.jar' }) }]);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(notify).toHaveBeenCalledWith('配置已保存', 'Sodium 的手动配置已更新。');
  });

  it('asks for a fresh identification and surfaces a failure without changing the row', async () => {
    load([adminMod({ binding: 'unbound', version: '' })]);
    const user = userEvent.setup();
    const notify = vi.fn();
    render(<AdminMods notify={notify} />);
    const resolve = await screen.findByRole('button', { name: '重新识别绑定 Sodium' });
    mocked.mockRejectedValueOnce(new Error('暂时无法连接 Modrinth。'));
    await user.click(resolve);
    await waitFor(() => expect(notify).toHaveBeenCalledWith('操作未完成', '暂时无法连接 Modrinth。'));
    expect(screen.getByRole('switch', { name: '启用 Sodium' })).toBeEnabled();
    expect(mocked.mock.calls.filter(([path]) => path === '/admin/mods')).toHaveLength(2);
  });

  it('shows a file problem and offers a retry when the list itself cannot be read', async () => {
    load([adminMod({ error: '目标位置已存在同名文件。' })]);
    render(<AdminMods notify={vi.fn()} />);
    expect(await screen.findByText('目标位置已存在同名文件。')).toBeInTheDocument();
    cleanup();
    mocked.mockReset().mockRejectedValue(new Error('登录已失效，请重新登录。'));
    render(<AdminMods notify={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('登录已失效');
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
  });
});
