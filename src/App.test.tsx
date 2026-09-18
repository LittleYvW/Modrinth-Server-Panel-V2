// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import App from './App';
import { api } from './api';
import type { PanelConfig } from '../shared/types';

vi.mock('./api', async original => ({ ...await original<typeof import('./api')>(), api: vi.fn() }));
const config: PanelConfig = { modsDirectory: '/mods', minecraftVersion: '1.20.1', loader: 'fabric', loaderVersion: null };
let registered: boolean;
let authenticated: boolean;
let reduced: boolean;
let panel: PanelConfig | null;
let panelLeft: number;

beforeEach(() => {
  vi.useFakeTimers();
  registered = true; authenticated = false; reduced = false; panel = config; panelLeft = 80;
  window.history.replaceState(null, '', '/');
  document.body.style.overflow = '';
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.open = false; } });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const dialog = this.tagName === 'DIALOG';
    return { left: dialog ? 400 : panelLeft, top: dialog ? 250 : 120, width: dialog ? 460 : 1100, height: dialog ? 340 : 600, right: 0, bottom: 0, x: 0, y: 0, toJSON() {} };
  });
  vi.mocked(api).mockReset().mockImplementation(async path => {
    if (path === '/auth/status') return { registered, authenticated, configured: !!panel };
    if (path === '/auth/login' || path === '/auth/register') return { registered: true, authenticated: true, configured: !!panel };
    if (path === '/admin/config') return panel;
    if (path === '/public/config') return null;
    if (path === '/public/mods' || path === '/admin/mods') return { revision: 1, mods: [], scanning: false, configured: true, issues: [] };
    if (path === '/auth/logout') return {};
    return { versions: [] };
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function openDialog() {
  await act(async () => { render(<App />); });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '管理' })); });
}
async function submit() {
  fireEvent.change(screen.getByLabelText(registered ? '管理员密码' : '设置密码'), { target: { value: 'test-password' } });
  if (!registered) fireEvent.change(screen.getByLabelText('确认密码'), { target: { value: 'test-password' } });
  await act(async () => { fireEvent.submit(document.querySelector('.admin-form')!); });
}
async function advance(ms = 800) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }

it('refreshes public game and loader icons alongside their labels', async () => {
  let current = { minecraftVersion: '1.20.1', minecraftVersionType: 'release', loader: 'fabric', loaderVersion: '0.15.11' };
  const existing = vi.mocked(api).getMockImplementation()!;
  vi.mocked(api).mockImplementation(async (path, options) => path === '/public/config' ? current : existing(path, options));
  await act(async () => { render(<App />); });
  expect(document.querySelector('.environment-icon-minecraft img')).toHaveAttribute('src', '/icons/minecraft-release.png');
  expect(document.querySelector('.environment-icon-loader img')).toHaveAttribute('src', '/icons/fabric.png');
  current = { minecraftVersion: '26.1-snapshot-10', minecraftVersionType: 'snapshot', loader: 'neoforge', loaderVersion: '26.1.0.0-alpha.13+snapshot-10' };
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  expect(screen.getByText('Minecraft 26.1-snapshot-10')).toBeInTheDocument();
  expect(screen.getByText('NeoForge 26.1.0.0-alpha.13+snapshot-10')).toBeInTheDocument();
  expect(document.querySelector('.environment-icon-minecraft img')).toHaveAttribute('src', '/icons/minecraft-snapshot.png');
  expect(document.querySelector('.environment-icon-loader img')).toHaveAttribute('src', '/icons/neoforge.png');
});

describe('authentication handoff', () => {
  it('keeps the header mounted and replaces management actions only after expansion', async () => {
    await openDialog();
    const brand = screen.getByRole('link', { name: 'Server Mods 首页' });
    const theme = screen.getByRole('switch', { name: '深色主题' });
    await submit();
    expect(screen.getByRole('button', { name: '管理' })).toHaveClass('management-leaving');
    expect(screen.queryByRole('button', { name: '设置' })).not.toBeInTheDocument();
    expect(document.querySelector('.navigation-layer')).toHaveAttribute('class', 'navigation-layer');
    await advance();
    expect(screen.getByRole('link', { name: 'Server Mods 首页' })).toBe(brand);
    expect(screen.getByRole('switch', { name: '深色主题' })).toBe(theme);
    expect(screen.queryByRole('button', { name: '管理' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '设置' }).parentElement).toHaveClass('controls-revealed');
    expect(screen.getByRole('button', { name: '退出' })).toBeEnabled();
  });

  it.each(['button', 'escape', 'backdrop'])('animates dismissal via %s and restores focus', async method => {
    await openDialog();
    const trigger = screen.getByRole('button', { name: '管理' });
    // jsdom does not focus click targets automatically, unlike the browser.
    fireEvent.click(screen.getByRole('button', { name: '关闭管理员登录' }));
    await advance(350);
    trigger.focus();
    await act(async () => { fireEvent.click(trigger); });
    const dialog = screen.getByRole('dialog');
    if (method === 'button') fireEvent.click(screen.getByRole('button', { name: '关闭管理员登录' }));
    else if (method === 'escape') fireEvent(dialog, new Event('cancel', { cancelable: true }));
    else fireEvent.click(dialog);
    expect(dialog).toHaveClass('auth-closing');
    expect(dialog.querySelector('.dialog-content')).toHaveAttribute('inert');
    await advance(100);
    expect(dialog).toBeInTheDocument();
    await advance(250);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('closes immediately with reduced motion', async () => {
    reduced = true;
    await openDialog();
    fireEvent.click(screen.getByRole('button', { name: '关闭管理员登录' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('ignores an authentication result that arrives while closing', async () => {
    await openDialog();
    let resolve!: (value: unknown) => void;
    vi.mocked(api).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await submit();
    fireEvent.click(screen.getByRole('button', { name: '关闭管理员登录' }));
    await act(async () => { resolve({ registered: true, authenticated: true, configured: true }); });
    expect(screen.getByRole('dialog')).toHaveClass('auth-closing');
    await advance(350);
    expect(document.querySelector('.admin-content')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each([true, false])('morphs after authentication (registered=%s), keeps particles mounted and transfers focus', async existing => {
    registered = existing;
    panel = existing ? config : null;
    await openDialog();
    const particles = document.querySelector('.floating-pixels');
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveClass('auth-dialog');
    await submit();
    expect(dialog).toHaveClass('auth-expanding');
    expect(document.querySelector('.admin-content')).toHaveAttribute('inert');
    expect(document.querySelector('.artwork')).toHaveClass('artwork-simple');
    fireEvent(dialog, new Event('cancel', { bubbles: false, cancelable: true }));
    fireEvent.click(dialog);
    fireEvent.submit(document.querySelector('.auth-dialog form')!);
    expect(dialog).toBeInTheDocument();
    expect(vi.mocked(api).mock.calls.filter(([path]) => path === (existing ? '/auth/login' : '/auth/register'))).toHaveLength(1);
    await advance(360);
    expect(parseFloat(dialog.style.width)).toBeGreaterThan(460);
    expect(parseFloat(dialog.style.left)).toBeLessThan(400);
    panelLeft = 25;
    await advance(352);
    expect(parseFloat(dialog.style.left)).toBeCloseTo(25, 0);
    await advance(100);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.querySelector('.admin-content')).not.toHaveAttribute('inert');
    expect(screen.getByRole('heading', { name: existing ? '模组管理器' : '让世界准备就绪。' })).toHaveFocus();
    expect(document.querySelector('.floating-pixels')).toBe(particles);
    expect(document.body.style.overflow).toBe('');
  });

  it('does not expand on a rejected password', async () => {
    await openDialog();
    vi.mocked(api).mockRejectedValueOnce(new Error('密码不正确'));
    await submit();
    expect(screen.getByRole('alert')).toHaveTextContent('密码不正确');
    expect(screen.getByRole('dialog')).not.toHaveClass('auth-expanding');
    expect(document.querySelector('.artwork')).not.toHaveClass('artwork-simple');
  });

  it('also transitions an existing session opened from the home page', async () => {
    authenticated = true;
    await openDialog();
    expect(screen.getByRole('dialog')).toHaveClass('auth-expanding');
    await advance();
    expect(screen.getByRole('heading', { name: '模组管理器' })).toHaveFocus();
    expect(vi.mocked(api).mock.calls.some(([path]) => path === '/auth/login')).toBe(false);
  });

  it('finishes immediately for reduced motion', async () => {
    reduced = true;
    await openDialog(); await submit();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '模组管理器' })).toHaveFocus();
    expect(document.body.style.overflow).toBe('');
  });

  it('enters a usable loading/error panel without waiting for configuration', async () => {
    await openDialog();
    let reject!: (error: Error) => void;
    const implementation = vi.mocked(api).getMockImplementation()!;
    vi.mocked(api).mockImplementation((path, options) => path === '/admin/config' ? new Promise((_, fail) => { reject = fail; }) : implementation(path, options));
    await submit(); await advance();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('正在加载工作空间…')).toBeInTheDocument();
    await act(async () => { reject(new Error('服务暂不可用')); });
    expect(screen.getByRole('alert')).toHaveTextContent('服务暂不可用');
    vi.mocked(api).mockImplementation(implementation);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '重试' })); });
    expect(screen.getByRole('heading', { name: '模组管理器' })).toBeInTheDocument();
  });

  it('falls back to completion when animation frames are suspended', async () => {
    await openDialog();
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(123);
    await submit(); await advance(1000);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('');
  });

  it('cancels a handoff on expiry and opens a fresh, usable authentication dialog', async () => {
    await openDialog(); await submit();
    await act(async () => { window.dispatchEvent(new Event('session-expired')); });
    expect(screen.getByRole('dialog')).not.toHaveClass('auth-expanding');
    expect(document.body.style.overflow).toBe('');
    await submit(); await advance();
    expect(screen.getByRole('heading', { name: '模组管理器' })).toBeInTheDocument();
  });

  it('restores decoration after logout without remounting the particles', async () => {
    await openDialog(); await submit(); await advance();
    const particles = document.querySelector('.floating-pixels');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '退出' })); });
    expect(document.querySelector('.artwork')).not.toHaveClass('artwork-simple');
    expect(document.querySelector('.floating-pixels')).toBe(particles);
  });

  it('cleans up a transition on navigation away', async () => {
    await openDialog(); await submit();
    await act(async () => {
      window.history.replaceState(null, '', '/');
      window.dispatchEvent(new Event('hashchange'));
    });
    await advance(1000);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('');
    expect(document.querySelector('.admin-content')).not.toBeInTheDocument();
  });

  it('keeps the login dialog open after changing the password in settings', async () => {
    await openDialog(); await submit(); await advance();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '设置' })); });
    expect(screen.getByRole('dialog', { name: '后台设置' })).not.toHaveClass('auth-dialog');
    fireEvent.change(screen.getByLabelText('当前密码'), { target: { value: 'test-password' } });
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'next-password' } });
    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'next-password' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '更新密码' })); });
    await advance(50);
    expect(screen.getByRole('dialog', { name: '管理员登录' })).toBeInTheDocument();
    expect(screen.getByLabelText('管理员密码')).toBeEnabled();
  });
});
