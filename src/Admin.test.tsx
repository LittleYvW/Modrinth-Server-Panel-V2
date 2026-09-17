// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { AuthDialog, ConfigForm, SettingsDialog, VersionFields } from './Admin';
import { api } from './api';
import type { DirectoryListing, PanelConfig } from '../shared/types';

vi.mock('./api', async importOriginal => ({ ...await importOriginal<typeof import('./api')>(), api: vi.fn() }));
const mockedApi = vi.mocked(api);
const config: PanelConfig = { modsDirectory: '/mods', minecraftVersion: '1.20.1', loader: 'fabric', loaderVersion: '0.15.11' };
beforeEach(() => {
  mockedApi.mockReset();
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.open = false; } });
});
afterEach(cleanup);

describe('password-only administrator dialog', () => {
  it('registers on first use and validates confirmation', async () => {
    mockedApi.mockResolvedValueOnce({ registered: false, authenticated: false, configured: false });
    const authenticated = vi.fn(); const user = userEvent.setup();
    render(<AuthDialog close={vi.fn()} authenticated={authenticated} />);
    await screen.findByRole('dialog', { name: '管理员注册' });
    await user.type(screen.getByLabelText('设置密码'), 'test-password');
    await user.type(screen.getByLabelText('确认密码'), 'different-password');
    await user.click(screen.getByRole('button', { name: '注册' }));
    expect(screen.getByRole('alert')).toHaveTextContent('不一致');
    await user.clear(screen.getByLabelText('确认密码')); await user.type(screen.getByLabelText('确认密码'), 'test-password');
    mockedApi.mockResolvedValueOnce({ registered: true, authenticated: true, configured: false });
    await user.click(screen.getByRole('button', { name: '注册' }));
    expect(authenticated).toHaveBeenCalledWith({ registered: true, authenticated: true, configured: false });
    expect(mockedApi.mock.calls[1][0]).toBe('/auth/register');
  });
  it('shows only one password field after registration and displays login errors', async () => {
    mockedApi.mockResolvedValueOnce({ registered: true, authenticated: false, configured: true });
    const user = userEvent.setup(); render(<AuthDialog close={vi.fn()} authenticated={vi.fn()} />);
    await screen.findByRole('dialog', { name: '管理员登录' });
    expect(screen.queryByLabelText('确认密码')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('管理员密码'), 'wrong-password');
    mockedApi.mockRejectedValueOnce(new Error('密码不正确，请重试。'));
    await user.click(screen.getByRole('button', { name: '登录' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('密码不正确');
  });
});

describe('directory and version configuration', () => {
  it('ignores a directory response after the path was edited', async () => {
    let finish!: (value: DirectoryListing) => void;
    mockedApi.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const user = userEvent.setup(); render(<ConfigForm wizard saved={vi.fn()} />);
    const input = screen.getByLabelText('模组目录');
    await user.type(input, '/old'); await user.click(screen.getByRole('button', { name: '检查' }));
    await user.clear(input); await user.type(input, '/new');
    await act(async () => finish({ path: '/old', entries: [{ name: 'old.jar', type: 'file' }] }));
    expect(input).toHaveValue('/new'); expect(screen.queryByText('old.jar')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '检查' })).toBeEnabled();
  });
  it('checks and confirms an empty directory, then saves manually entered versions while offline', async () => {
    mockedApi.mockImplementation(async (path, options) => {
      if (path === '/admin/directory/check') return { path: '/mods', entries: [] };
      if (path === '/admin/config') return JSON.parse(options!.body as string);
      throw new Error('暂时无法获取在线版本，请重试或手动输入版本号。');
    });
    const saved = vi.fn(); const user = userEvent.setup(); render(<ConfigForm wizard saved={saved} />);
    await user.type(screen.getByLabelText('模组目录'), '/mods');
    await user.click(screen.getByRole('button', { name: '检查' }));
    expect(await screen.findByText('这是一个空目录，可以继续。')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '确认' }));
    await screen.findByText('选择游戏环境');
    await user.type(screen.getByLabelText('Minecraft 版本'), '1.20.1');
    await user.selectOptions(screen.getByLabelText('模组加载器'), 'quilt');
    await user.click(screen.getByRole('button', { name: '完成配置' }));
    expect(saved).toHaveBeenCalledWith({ ...config, loader: 'quilt', loaderVersion: null });
  });
  it('requires rechecking and confirming a changed settings directory before saving', async () => {
    mockedApi.mockImplementation(async path => path === '/admin/directory/check' ? { path: '/new', entries: [] } : { versions: [] });
    const user = userEvent.setup(); render(<ConfigForm initial={config} saved={vi.fn()} />);
    await user.clear(screen.getByLabelText('模组目录')); await user.type(screen.getByLabelText('模组目录'), '/new');
    expect(screen.getByRole('button', { name: '保存配置' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '检查' }));
    expect(screen.getByRole('button', { name: '保存配置' })).toBeDisabled();
    await user.click(await screen.findByRole('button', { name: '确认' }));
    expect(screen.getByRole('button', { name: '保存配置' })).toBeEnabled();
  });
  it('clears the loader version when the game or loader changes and toggles snapshot suggestions', async () => {
    mockedApi.mockResolvedValue({ versions: [{ id: '1.20.1', type: 'release' }, { id: '24w01a', type: 'snapshot' }] });
    function Controlled() { const [value, change] = useState(config); return <VersionFields value={value} change={change} disabled={false} />; }
    const user = userEvent.setup(); const view = render(<Controlled />);
    await waitFor(() => expect(view.container.querySelector('option[value="1.20.1"]')).toBeInTheDocument());
    expect(view.container.querySelector('option[value="24w01a"]')).not.toBeInTheDocument();
    await user.click(screen.getByLabelText('显示快照版本'));
    expect(view.container.querySelector('option[value="24w01a"]')).toBeInTheDocument();
    const loaderVersion = screen.getByLabelText(/加载器版本/);
    await user.selectOptions(screen.getByLabelText('模组加载器'), 'forge'); expect(loaderVersion).toHaveValue('');
    await user.type(loaderVersion, '47.1.0'); fireEvent.change(screen.getByLabelText('Minecraft 版本'), { target: { value: '1.21.1' } });
    expect(loaderVersion).toHaveValue('');
  });
  it('cancels a settings draft without submitting it', async () => {
    mockedApi.mockResolvedValue({ versions: [] });
    const close = vi.fn(); const saved = vi.fn(); const user = userEvent.setup();
    render(<SettingsDialog config={config} close={close} saved={saved} theme="dark" toggleTheme={vi.fn()} passwordChanged={vi.fn()} />);
    await user.clear(screen.getByLabelText('Minecraft 版本')); await user.type(screen.getByLabelText('Minecraft 版本'), '1.21.1');
    await user.click(screen.getByRole('button', { name: '取消并关闭' }));
    expect(close).toHaveBeenCalled(); expect(saved).not.toHaveBeenCalled();
    expect(mockedApi.mock.calls.some(([path]) => path === '/admin/config')).toBe(false);
  });
});
