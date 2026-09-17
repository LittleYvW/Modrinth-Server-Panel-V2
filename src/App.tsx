import { useEffect, useState } from 'react';
import { ArrowDownToLine, CheckCheck, LoaderCircle, LogOut, Moon, Settings, Sun, X } from 'lucide-react';
import Artwork, { Cube, FabricIcon, GrassBlock } from './Artwork';
import { mods } from './data';
import { AuthDialog, ConfigForm, SettingsDialog } from './Admin';
import { api, errorMessage } from './api';
import { loaderNames, type AuthStatus, type PanelConfig, type PublicConfig } from '../shared/types';

type Theme = 'dark' | 'light';
function readTheme(): Theme {
  try { return localStorage.getItem('server-mods-theme') === 'light' ? 'light' : 'dark'; }
  catch { return 'dark'; }
}
function Header({ theme, toggleTheme, manage, admin, configured, logout, busy }: {
  theme: Theme; toggleTheme: () => void; manage: () => void; admin: boolean; configured: boolean; logout: () => void; busy: boolean;
}) {
  return <header className="header"><div className="header-inner"><a className="brand" href="#" aria-label="Server Mods 首页"><Cube /><span>Server Mods</span></a><div className="header-actions">
    <button className="manage-button" onClick={manage} disabled={admin && (!configured || busy)}><Settings size={18} /><span>{admin ? '设置' : '管理'}</span></button>
    {admin && <button className="manage-button" onClick={logout} disabled={busy}><LogOut size={18} /><span>退出</span></button>}
    <div className="theme-control"><Sun size={19} /><button className="theme-switch" role="switch" aria-checked={theme === 'dark'} aria-label="深色主题" onClick={toggleTheme}><span /></button><Moon size={18} /></div>
  </div></div></header>;
}
const demoConfig: PublicConfig = { minecraftVersion: '1.20.1', loader: 'fabric', loaderVersion: '0.15.11' };
function Hero({ config }: { config: PublicConfig | null }) {
  const value = config ?? demoConfig;
  return <section className="hero" aria-label="整合包版本"><p className="eyebrow">A MORE OPEN TOMORROW.</p><h1><GrassBlock /><span>Minecraft {value.minecraftVersion}</span></h1><span className="hero-divider" /><h2>{value.loader === 'fabric' ? <FabricIcon /> : <Cube className="loader-cube" />}<span>{loaderNames[value.loader]}{value.loaderVersion ? ` ${value.loaderVersion}` : ''}</span></h2><p className="tagline">同一个世界，无限种可能。</p></section>;
}
function DownloadCard({ download }: { download: (name: string) => void }) {
  return <button className="download-card" onClick={() => download('完整整合包')}><span className="pixel-corner corner-one" /><ArrowDownToLine size={62} strokeWidth={1.8} /><strong>下载整合包</strong><span className="download-subtitle">客户端 & 服务器模组</span><span className="pixel-corner corner-two" /></button>;
}
function ModList({ download }: { download: (name: string) => void }) {
  return <section className="mods-panel" aria-labelledby="mods-title"><div className="panel-heading"><h2 id="mods-title"><Cube />包含的模组</h2><span>{mods.length} 个模组</span></div><ul className="mod-list">{mods.map(mod => <li className="mod-row" key={mod.name}><div className="mod-icon"><Cube /></div><div className="mod-info"><h3>{mod.name}</h3><p>{mod.description}</p></div><span className={`mod-side ${mod.side}`}><Cube />{mod.side === 'client' ? '客户端' : '双端通用'}</span><span className="mod-version">v{mod.version}</span><button className="icon-button mod-download" aria-label={`下载 ${mod.name}`} onClick={() => download(mod.name)}><ArrowDownToLine size={23} /></button></li>)}</ul></section>;
}
export default function App() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [route, setRoute] = useState(window.location.hash);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [settings, setSettings] = useState(false);
  const [config, setConfig] = useState<PanelConfig | null | undefined>();
  const [publicConfig, setPublicConfig] = useState<PublicConfig | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ name: string; text: string; id: number } | null>(null);
  const isAdminRoute = route === '#/admin';
  const admin = isAdminRoute && !!auth?.authenticated;
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
    const change = () => setRoute(window.location.hash);
    const expired = () => {
      setAuth(current => current ? { ...current, authenticated: false } : null);
      setConfig(undefined); setSettings(false); setAuthOpen(true); setRoute(''); window.location.hash = '';
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
  const toggleTheme = () => setTheme(current => current === 'dark' ? 'light' : 'dark');
  function onAuthenticated(status: AuthStatus) {
    setAuth(status); setAuthOpen(false); setError(''); window.location.hash = '/admin';
  }
  function onSaved(value: PanelConfig) {
    setConfig(value); setPublicConfig(value); setSettings(false);
    setAuth(current => current ? { ...current, configured: true } : current);
    notify('配置已保存', '游戏环境已更新。');
  }
  function signedOut() {
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
  return <><Header theme={theme} toggleTheme={toggleTheme} manage={manage} admin={admin} configured={!!config} logout={logout} busy={busy} />
    <main className={admin ? 'admin-main' : undefined}><Artwork />
      {admin ? <div className="admin-content">
        {config === undefined ? <div className="setup-panel loading-panel">{error ? <><p className="form-error" role="alert">{error}</p><button className="secondary-button" onClick={() => setRetry(n => n + 1)}>重试</button></> : <><LoaderCircle className="spin" size={24} /><p>正在加载工作空间…</p></>}</div>
          : config === null ? <section className="setup-panel"><div className="workspace-intro"><span className="section-kicker">WELCOME TO YOUR WORKSPACE</span><h1>让世界准备就绪。</h1><p>完成两个简单设置，开始管理你的模组。</p></div><ConfigForm wizard saved={onSaved} /></section>
            : <section className="manager-workspace" aria-labelledby="manager-title"><div className="workspace-heading"><div><span className="section-kicker">YOUR WORKSPACE</span><h1 id="manager-title">模组管理器</h1></div><span className="environment-badge">Minecraft {config.minecraftVersion}<span />{loaderNames[config.loader]}{config.loaderVersion ? ` ${config.loaderVersion}` : ''}</span></div><div className="empty-workspace" /></section>}
      </div> : <div className="main-content"><Hero config={publicConfig} /><DownloadCard download={name => notify(name, '演示模式：暂未接入真实下载资源。')} /><ModList download={name => notify(name, '演示模式：暂未接入真实下载资源。')} /><footer><span className="status-dot" />为更好的游戏体验而构建<span className="footer-separator">/</span><span>保持原版，探索更多。</span></footer></div>}
    </main>
    {authOpen && <AuthDialog close={() => { setAuthOpen(false); if (isAdminRoute && !auth?.authenticated) window.location.hash = ''; }} authenticated={onAuthenticated} />}
    {settings && config && <SettingsDialog config={config} close={() => setSettings(false)} saved={onSaved} theme={theme} toggleTheme={toggleTheme} passwordChanged={() => { signedOut(); setAuthOpen(true); notify('密码已更新', '请使用新密码重新登录。'); }} />}
    <div className="toast-region" role="status" aria-live="polite">{toast && <div className="toast" key={toast.id}><CheckCheck size={22} /><div><strong>{toast.name}</strong><p>{toast.text}</p></div><button aria-label="关闭提示" onClick={() => setToast(null)}><X size={18} /></button></div>}</div>
  </>;
}
