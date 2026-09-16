import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, Check, CheckCheck, Monitor, Moon, Settings, Sun, X } from 'lucide-react';
import Artwork, { Cube, FabricIcon, GrassBlock } from './Artwork';
import { mods } from './data';
type Theme = 'dark' | 'light';
function readTheme(): Theme {
  try {
    return localStorage.getItem('server-mods-theme') === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}
function Header({
  theme,
  toggleTheme,
  manage
}: {
  theme: Theme;
  toggleTheme: () => void;
  manage: () => void;
}) {
  return <header className="header"><div className="header-inner"><a className="brand" href="#" aria-label="Server Mods 首页"><Cube /><span>Server Mods</span></a><div className="header-actions"><button className="manage-button" onClick={manage}><Settings size={18} /><span>管理</span></button><div className="theme-control"><Sun size={19} /><button className="theme-switch" role="switch" aria-checked={theme === 'dark'} aria-label="深色主题" onClick={toggleTheme}><span /></button><Moon size={18} /></div></div></div></header>;
}
function Hero() {
  return <section className="hero" aria-label="整合包版本"><p className="eyebrow">A MORE OPEN TOMORROW.</p><h1><GrassBlock /><span>Minecraft 1.20.1</span></h1><span className="hero-divider" /><h2><FabricIcon /><span>Fabric 0.15.11</span></h2><p className="tagline">同一个世界，无限种可能。</p></section>;
}
function DownloadCard({
  download
}: {
  download: (name: string) => void;
}) {
  return <button className="download-card" onClick={() => download('完整整合包')}><span className="pixel-corner corner-one" /><ArrowDownToLine size={62} strokeWidth={1.8} /><strong>下载整合包</strong><span className="download-subtitle">客户端 & 服务器模组</span><span className="pixel-corner corner-two" /></button>;
}
function ModList({
  download
}: {
  download: (name: string) => void;
}) {
  return <section className="mods-panel" aria-labelledby="mods-title"><div className="panel-heading"><h2 id="mods-title"><Cube />包含的模组</h2><span>{mods.length} 个模组</span></div><ul className="mod-list">{mods.map(mod => <li className="mod-row" key={mod.name}><div className="mod-icon"><Cube /></div><div className="mod-info"><h3>{mod.name}</h3><p>{mod.description}</p></div><span className={`mod-side ${mod.side}`}><Cube />{mod.side === 'client' ? '客户端' : '双端通用'}</span><span className="mod-version">v{mod.version}</span><button className="icon-button mod-download" aria-label={`下载 ${mod.name}`} onClick={() => download(mod.name)}><ArrowDownToLine size={23} /></button></li>)}</ul></section>;
}
function ManageDialog({
  open,
  close,
  theme,
  toggleTheme
}: {
  open: boolean;
  close: () => void;
  theme: Theme;
  toggleTheme: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal();else if (!open && ref.current?.open) ref.current?.close();
  }, [open]);
  return <dialog ref={ref} className="settings-dialog" aria-label="管理设置" onKeyDown={e => {
    if (e.key !== 'Tab') return;
    const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button'));
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }} onCancel={close} onClose={close} onClick={e => {
    if (e.target === ref.current) close();
  }}><div className="dialog-content"><div className="dialog-heading"><div><span className="section-kicker">WORKSPACE SETTINGS</span><h2>管理设置</h2></div><button className="icon-button" aria-label="关闭设置" onClick={close} autoFocus><X size={20} /></button></div><div className="notice"><Monitor size={20} /><p>当前为本地演示模式。<br /><span>下载与服务器管理尚未连接真实服务。</span></p></div><div className="setting-row"><div><h3>界面主题</h3><p>偏好将保存在当前浏览器中</p></div><button className="theme-choice" onClick={toggleTheme}>{theme === 'dark' ? <Moon size={16} /> : <Sun size={16} />} {theme === 'dark' ? '深色' : '浅色'}</button></div><div className="setting-row"><div><h3>游戏版本</h3><p>Minecraft 1.20.1</p></div><span className="setting-value">Fabric 0.15.11</span></div><button className="done-button" onClick={close}><Check size={17} />完成</button></div></dialog>;
}
export default function App() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [settings, setSettings] = useState(false);
  const [toast, setToast] = useState<{
    name: string;
    id: number;
  } | null>(null);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('server-mods-theme', theme);
    } catch {/* Private browsers may disable storage. */}
  }, [theme]);
  useEffect(() => {
    if (toast) {
      const timer = window.setTimeout(() => setToast(null), 5000);
      return () => window.clearTimeout(timer);
    }
  }, [toast]);
  const toggleTheme = () => setTheme(current => current === 'dark' ? 'light' : 'dark');
  const download = (name: string) => setToast({
    name,
    id: Date.now()
  });
  return <><Header theme={theme} toggleTheme={toggleTheme} manage={() => setSettings(true)} /><main><Artwork /><div className="main-content"><Hero /><DownloadCard download={download} /><ModList download={download} /><footer><span className="status-dot" />为更好的游戏体验而构建<span className="footer-separator">/</span><span>保持原版，探索更多。</span></footer></div></main><ManageDialog open={settings} close={() => setSettings(false)} theme={theme} toggleTheme={toggleTheme} /><div className="toast-region" role="status" aria-live="polite">{toast && <div className="toast" key={toast.id}><CheckCheck size={22} /><div><strong>{toast.name}</strong><p>演示模式：暂未接入真实下载资源。</p></div><button aria-label="关闭提示" onClick={() => setToast(null)}><X size={18} /></button></div>}</div></>;
}
