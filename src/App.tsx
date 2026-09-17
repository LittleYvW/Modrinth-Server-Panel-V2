import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDownToLine, CheckCheck, LoaderCircle, LogOut, Moon, Settings, Sun, X } from 'lucide-react';
import Artwork, { Cube, FabricIcon, GrassBlock } from './Artwork';
import { AdminMods, PublicMods } from './Mods';
import { AuthDialog, ConfigForm, SettingsDialog } from './Admin';
import { api, errorMessage } from './api';
import { loaderNames, type AuthStatus, type PanelConfig, type PublicConfig } from '../shared/types';

type Theme = 'dark' | 'light';
function readTheme(): Theme {
  try { return localStorage.getItem('server-mods-theme') === 'light' ? 'light' : 'dark'; }
  catch { return 'dark'; }
}
function Header({ theme, toggleTheme, manage, admin, configured, logout, busy, expanding, revealed }: {
  theme: Theme; toggleTheme: () => void; manage: () => void; admin: boolean; configured: boolean; logout: () => void; busy: boolean; expanding: boolean; revealed: boolean;
}) {
  return <header className="header"><div className="header-inner"><a className="brand" href="#" aria-label="Server Mods 首页"><Cube /><span>Server Mods</span></a><div className="header-actions">
    <div className="management-controls">
      {(!admin || expanding) && <button className={`manage-button${expanding ? ' management-leaving' : ''}`} onClick={manage} disabled={expanding}><Settings size={18} /><span>管理</span></button>}
      {admin && <div className={`admin-controls${expanding ? ' controls-preparing' : revealed ? ' controls-revealed' : ''}`} aria-hidden={expanding || undefined} inert={expanding}>
        <button className="manage-button" onClick={manage} disabled={!configured || busy}><Settings size={18} /><span>设置</span></button>
        <button className="manage-button" onClick={logout} disabled={busy}><LogOut size={18} /><span>退出</span></button>
      </div>}
    </div>
    <div className="theme-control"><Sun size={19} /><button className="theme-switch" role="switch" aria-checked={theme === 'dark'} aria-label="深色主题" onClick={toggleTheme}><span /></button><Moon size={18} /></div>
  </div></div></header>;
}
const demoConfig: PublicConfig = { minecraftVersion: '1.20.1', loader: 'fabric', loaderVersion: '0.15.11' };
function Hero({ config }: { config: PublicConfig | null }) {
  const value = config ?? demoConfig;
  return <section className="hero" aria-label="整合包版本"><p className="eyebrow">A MORE OPEN TOMORROW.</p><h1><GrassBlock /><span>Minecraft {value.minecraftVersion}</span></h1><span className="hero-divider" /><h2>{value.loader === 'fabric' ? <FabricIcon /> : <Cube className="loader-cube" />}<span>{loaderNames[value.loader]}{value.loaderVersion ? ` ${value.loaderVersion}` : ''}</span></h2><p className="tagline">同一个世界，无限种可能。</p></section>;
}
function DownloadCard({ download }: { download: () => void }) {
  return <button className="download-card" onClick={download}><span className="pixel-corner corner-one" /><ArrowDownToLine size={62} strokeWidth={1.8} /><strong>下载整合包</strong><span className="download-subtitle">暂未开放，可先按分类下载单个模组</span><span className="pixel-corner corner-two" /></button>;
}
export default function App() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [route, setRoute] = useState(window.location.hash);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authAttempt, setAuthAttempt] = useState(0);
  const [transition, setTransition] = useState<'idle' | 'expanding' | 'revealed'>('idle');
  const adminContent = useRef<HTMLDivElement>(null);
  const needsHandoffFocus = useRef(false);
  const [settings, setSettings] = useState(false);
  const [config, setConfig] = useState<PanelConfig | null | undefined>();
  const [publicConfig, setPublicConfig] = useState<PublicConfig | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ name: string; text: string; id: number } | null>(null);
  const isAdminRoute = route === '#/admin';
  const admin = isAdminRoute && !!auth?.authenticated;
  const expanding = transition === 'expanding';
  const handoffActive = useRef(false);
  handoffActive.current = expanding;
  const notify = (name: string, text: string) => setToast({ name, text, id: Date.now() });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('server-mods-theme', theme); } catch { /* Storage is optional for theme. */ }
  }, [theme]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const change = () => {
      setRoute(window.location.hash);
      if (window.location.hash !== '#/admin') {
        setTransition('idle');
        if (handoffActive.current) setAuthOpen(false);
      }
    };
    const expired = () => {
      setAuth(current => current ? { ...current, authenticated: false } : null);
      setTransition('idle'); setAuthAttempt(value => value + 1);
      setConfig(undefined); setSettings(false); setAuthOpen(true); setRoute('');
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
      notify('请重新登录', '登录已失效，请输入管理员密码。');
    };
    window.addEventListener('hashchange', change); window.addEventListener('session-expired', expired);
    return () => { window.removeEventListener('hashchange', change); window.removeEventListener('session-expired', expired); };
  }, []);
  useEffect(() => {
    const request = new AbortController();
    api<AuthStatus>('/auth/status', { signal: request.signal }).then(result => setAuth(current => current ?? result)).catch(() => { /* Auth dialog offers retry. */ });
    return () => request.abort();
  }, []);
  useEffect(() => {
    const request = new AbortController();
    const refresh = () => { api<PublicConfig | null>('/public/config', { signal: request.signal }).then(setPublicConfig).catch(() => { /* Keep last known public settings. */ }); };
    refresh(); window.addEventListener('focus', refresh);
    return () => { request.abort(); window.removeEventListener('focus', refresh); };
  }, [route]);
  useEffect(() => {
    if (isAdminRoute && !auth?.authenticated) setAuthOpen(true);
  }, [isAdminRoute, auth?.authenticated]);
  useEffect(() => {
    if (!auth?.authenticated) return;
    const request = new AbortController(); setError(''); setConfig(undefined);
    api<PanelConfig | null>('/admin/config', { signal: request.signal }).then(setConfig)
      .catch(error => { if (!request.signal.aborted) setError(errorMessage(error)); });
    return () => request.abort();
  }, [auth?.authenticated, retry]);
  useLayoutEffect(() => {
    if (transition !== 'revealed' || !admin) return;
    const content = adminContent.current;
    if (!needsHandoffFocus.current && document.activeElement !== content) return;
    const focusTarget = content?.querySelector<HTMLElement>('h1, input:not(:disabled), button:not(:disabled)') ?? content;
    if (focusTarget) {
      if (focusTarget === content || focusTarget.tagName === 'H1') focusTarget.tabIndex = -1;
      focusTarget.focus({ preventScroll: true });
      needsHandoffFocus.current = false;
    }
  }, [transition, admin, config]);
  const toggleTheme = () => setTheme(current => current === 'dark' ? 'light' : 'dark');
  function onAuthenticated(status: AuthStatus) {
    setAuth(status); setTransition('expanding'); setError(''); setRoute('#/admin'); window.location.hash = '/admin';
  }
  function finishAuthTransition() {
    needsHandoffFocus.current = true;
    setAuthOpen(false); setTransition('revealed');
  }
  function onSaved(value: PanelConfig) {
    setConfig(value); setPublicConfig(value); setSettings(false);
    setAuth(current => current ? { ...current, configured: true } : current);
    notify('配置已保存', '游戏环境已更新。');
  }
  function signedOut() {
    setTransition('idle');
    setAuth(current => current ? { ...current, authenticated: false } : current);
    setConfig(undefined); setSettings(false); setRoute(''); window.location.hash = '';
  }
  async function logout() {
    setBusy(true);
    try { await api('/auth/logout', { method: 'POST', body: '{}' }); signedOut(); }
    catch (error) { notify('退出失败', errorMessage(error)); }
    finally { setBusy(false); }
  }
  function manage() {
    if (admin) setSettings(true);
    else setAuthOpen(true);
  }
  return <><div className="navigation-layer" inert={expanding}><Header theme={theme} toggleTheme={toggleTheme} manage={manage} admin={admin} configured={!!config} logout={logout} busy={busy} expanding={expanding} revealed={transition === 'revealed'} /></div>
    <main className={admin ? 'admin-main' : undefined}><Artwork simple={admin} />
      {admin && <div ref={adminContent} className={`admin-content${expanding ? ' admin-preparing' : transition === 'revealed' ? ' admin-revealed' : ''}`} inert={expanding} aria-hidden={expanding || undefined} tabIndex={-1}>
        {config === undefined ? <div className="setup-panel loading-panel">{error ? <><p className="form-error" role="alert">{error}</p><button className="secondary-button" onClick={() => setRetry(n => n + 1)}>重试</button></> : <><LoaderCircle className="spin" size={24} /><p>正在加载工作空间…</p></>}</div>
          : config === null ? <section className="setup-panel"><div className="workspace-intro"><span className="section-kicker">WELCOME TO YOUR WORKSPACE</span><h1>让世界准备就绪。</h1><p>完成两个简单设置，开始管理你的模组。</p></div><ConfigForm wizard saved={onSaved} /></section>
            : <section className="manager-workspace" aria-labelledby="manager-title"><div className="workspace-heading"><div><span className="section-kicker">YOUR WORKSPACE</span><h1 id="manager-title">模组管理器</h1></div><span className="environment-badge">Minecraft {config.minecraftVersion}<span />{loaderNames[config.loader]}{config.loaderVersion ? ` ${config.loaderVersion}` : ''}</span></div><AdminMods notify={notify} /></section>}
      </div>}
      {(!admin || expanding) && <div className={`main-content${expanding ? ' home-leaving' : ''}`} inert={expanding} aria-hidden={expanding || undefined}><Hero config={publicConfig} /><DownloadCard download={() => notify('整合包下载', '整合包打包功能暂未开放，可在下方按分类下载单个模组。')} /><PublicMods /><footer><span className="status-dot" />为更好的游戏体验而构建<span className="footer-separator">/</span><span>保持原版，探索更多。</span></footer></div>}
    </main>
    {authOpen && <AuthDialog key={authAttempt} close={() => { setAuthOpen(false); if (isAdminRoute && !auth?.authenticated) window.location.hash = ''; }} authenticated={onAuthenticated} transition={expanding ? { target: adminContent, complete: finishAuthTransition } : undefined} />}
    {settings && config && <SettingsDialog config={config} close={() => setSettings(false)} saved={onSaved} theme={theme} toggleTheme={toggleTheme} passwordChanged={() => { signedOut(); setAuthOpen(true); notify('密码已更新', '请使用新密码重新登录。'); }} />}
    <div className="toast-region" role="status" aria-live="polite">{toast && <div className="toast" key={toast.id}><CheckCheck size={22} /><div><strong>{toast.name}</strong><p>{toast.text}</p></div><button aria-label="关闭提示" onClick={() => setToast(null)}><X size={18} /></button></div>}</div>
  </>;
}
