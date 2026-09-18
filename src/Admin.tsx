import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Check, File, Folder, KeyRound, LoaderCircle, Moon, RefreshCw, Sun } from 'lucide-react';
import { loaders, loaderNames, type AuthStatus, type DirectoryListing, type DisplaySettings, type PanelConfig, type VersionList } from '../shared/types';
import { api, errorMessage } from './api';
import Modal from './Modal';
import type { DialogTransition } from './useDialogTransition';

// `close` is omitted while the panel is not yet set up: signing in is then the only way forward.
export function AuthDialog({ close, authenticated, transition }: { close?: () => void; authenticated: (status: AuthStatus) => void; transition?: DialogTransition }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const accepted = useRef(false);
  const accept = (result: AuthStatus) => {
    if (accepted.current) return;
    accepted.current = true;
    authenticated(result);
  };
  const load = () => {
    setError('');
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    api<AuthStatus>('/auth/status', { signal: request.signal }).then(result => {
      if (request.signal.aborted) return;
      setStatus(result);
      if (result.authenticated) accept(result);
    }).catch(error => { if (!request.signal.aborted) setError(errorMessage(error)); });
  };
  useEffect(() => { load(); return () => controller.current?.abort(); }, []); // An existing session skips the password.
  useEffect(() => { if (status) passwordRef.current?.focus(); }, [status]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!status || busy || accepted.current || transition) return;
    setBusy(true); setError('');
    const request = new AbortController(); controller.current = request;
    try {
      const result = await api<AuthStatus>('/auth/login', { method: 'POST', body: JSON.stringify({ password }), signal: request.signal });
      if (!request.signal.aborted) accept(result);
    } catch (error) {
      if (!request.signal.aborted) setError(errorMessage(error));
    } finally { setBusy(false); }
  }
  return <Modal title={status ? '管理员登录' : '管理员验证'} kicker="ADMIN ACCESS" close={close} entrance transition={transition} onCloseStart={() => { accepted.current = true; controller.current?.abort(); }}>
    {!status ? <div className="form-intro"><p>{error || '正在连接管理服务…'}</p>{error && <button className="secondary-button" onClick={load}>重试</button>}</div> : <form className="admin-form" onSubmit={submit}>
      <p className="form-description">{close ? '输入管理员密码，继续管理你的模组工作空间。' : '面板尚未完成设置，请输入管理员密码开始引导。密码由服务器环境变量 ADMIN_PASSWORD 设置。'}</p>
      <label className="field">管理员密码<input ref={passwordRef} type="password" autoComplete="current-password" maxLength={256} required value={password} onChange={e => setPassword(e.target.value)} placeholder="输入密码" disabled={busy} /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="done-button" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : <KeyRound size={18} />}{busy ? '正在验证…' : '登录'}</button>
    </form>}
  </Modal>;
}

export function VersionFields({ value, change, disabled }: { value: PanelConfig; change: (value: PanelConfig) => void; disabled: boolean }) {
  const id = useId();
  const [snapshots, setSnapshots] = useState(false);
  const [retry, setRetry] = useState(0);
  const [gameList, setGameList] = useState<VersionList>({ versions: [] });
  const [loaderList, setLoaderList] = useState<VersionList>({ versions: [] });
  const [gameError, setGameError] = useState('');
  const [loaderError, setLoaderError] = useState('');
  const [gameLoading, setGameLoading] = useState(false);
  const [loaderLoading, setLoaderLoading] = useState(false);
  const [loaderLoaded, setLoaderLoaded] = useState(false);
  useEffect(() => {
    const request = new AbortController(); setGameLoading(true); setGameError('');
    api<VersionList>('/admin/versions/minecraft', { signal: request.signal }).then(setGameList)
      .catch(error => { if (!request.signal.aborted) setGameError(errorMessage(error)); })
      .finally(() => { if (!request.signal.aborted) setGameLoading(false); });
    return () => request.abort();
  }, [retry]);
  useEffect(() => {
    const request = new AbortController(); setLoaderList({ versions: [] }); setLoaderError(''); setLoaderLoading(false); setLoaderLoaded(false);
    if (!value.minecraftVersion.trim()) return;
    // Avoid requests for every keystroke when entering a custom version.
    const timer = window.setTimeout(() => {
      setLoaderLoading(true);
      api<VersionList>(`/admin/versions/loaders?loader=${value.loader}&minecraft=${encodeURIComponent(value.minecraftVersion.trim())}`, { signal: request.signal })
        .then(list => { setLoaderList(list); setLoaderLoaded(true); })
        .catch(error => { if (!request.signal.aborted) setLoaderError(errorMessage(error)); })
        .finally(() => { if (!request.signal.aborted) setLoaderLoading(false); });
    }, 300);
    return () => { clearTimeout(timer); request.abort(); };
  }, [value.minecraftVersion, value.loader, retry]);
  return <div className="version-fields">
    <div className="field-heading"><span>游戏与加载器</span><button type="button" className="text-button" onClick={() => setRetry(n => n + 1)} disabled={disabled}><RefreshCw size={13} />刷新版本</button></div>
    <label className="field">Minecraft 版本<input list={`${id}-minecraft`} value={value.minecraftVersion} onChange={e => change({ ...value, minecraftVersion: e.target.value, loaderVersion: null })} placeholder="选择或输入，如 1.20.1" maxLength={100} required disabled={disabled} /></label>
    <datalist id={`${id}-minecraft`}>{gameList.versions.filter(v => snapshots || v.type !== 'snapshot').map(v => <option key={v.id} value={v.id} />)}</datalist>
    <label className="checkbox-field"><input type="checkbox" checked={snapshots} onChange={e => setSnapshots(e.target.checked)} disabled={disabled} />显示快照版本</label>
    <div className="form-columns"><label className="field">模组加载器<select value={value.loader} onChange={e => change({ ...value, loader: e.target.value as PanelConfig['loader'], loaderVersion: null })} disabled={disabled}>{loaders.map(loader => <option key={loader} value={loader}>{loaderNames[loader]}</option>)}</select></label>
      <label className="field">加载器版本 <span className="optional">可选</span><input list={`${id}-loader`} value={value.loaderVersion ?? ''} onChange={e => change({ ...value, loaderVersion: e.target.value || null })} placeholder="不指定版本" maxLength={100} disabled={disabled} /></label></div>
    <datalist id={`${id}-loader`}>{loaderList.versions.map(v => <option key={v.id} value={v.id} label={v.type ? '测试版' : undefined} />)}</datalist>
    <div className="version-status" aria-live="polite">{(gameLoading || loaderLoading) && <p>正在获取在线版本…</p>}{(gameList.stale || loaderList.stale) && <p>在线版本源暂不可用，正在使用缓存列表。</p>}{gameError && <p>{gameError}</p>}{loaderError && <p>{loaderError}</p>}{loaderLoaded && !loaderList.versions.length && <p>该 Minecraft 版本暂无 {loaderNames[value.loader]} 在线构建，可手动输入版本号。</p>}{!gameError && !loaderError && <p>支持直接输入版本号；加载器版本留空表示不指定版本。</p>}</div>
  </div>;
}

const initialConfig: PanelConfig = { modsDirectory: '', minecraftVersion: '', loader: 'fabric', loaderVersion: null };
export function ConfigForm({ initial, saved, wizard = false }: { initial?: PanelConfig; saved: (value: PanelConfig) => void; wizard?: boolean }) {
  const [draft, setDraft] = useState<PanelConfig>(initial ?? initialConfig);
  const [step, setStep] = useState(1);
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [confirmed, setConfirmed] = useState(initial?.modsDirectory ?? '');
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [directoryError, setDirectoryError] = useState('');
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { sequence.current++; request.current?.abort(); }, []);
  function changePath(path: string) {
    sequence.current++; request.current?.abort();
    setDraft(current => ({ ...current, modsDirectory: path }));
    setListing(null); setConfirmed(''); setChecking(false); setDirectoryError(''); setError('');
  }
  async function checkDirectory() {
    if (listing || (confirmed && confirmed === draft.modsDirectory)) {
      setConfirmed(draft.modsDirectory); if (wizard) setStep(2); return;
    }
    const current = ++sequence.current;
    request.current = new AbortController(); setChecking(true); setDirectoryError('');
    try {
      const result = await api<DirectoryListing>('/admin/directory/check', { method: 'POST', body: JSON.stringify({ path: draft.modsDirectory }), signal: request.current.signal });
      if (current !== sequence.current) return;
      setDraft(previous => ({ ...previous, modsDirectory: result.path })); setListing(result);
    } catch (error) { if (current === sequence.current) setDirectoryError(errorMessage(error)); }
    finally { if (current === sequence.current) setChecking(false); }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!confirmed || confirmed !== draft.modsDirectory) { setDirectoryError('请先检查并确认目录。'); return; }
    setSaving(true); setError('');
    try { saved(await api<PanelConfig>('/admin/config', { method: 'PUT', body: JSON.stringify(draft) })); }
    catch (error) { setError(errorMessage(error)); }
    finally { setSaving(false); }
  }
  return <form className="admin-form config-form" onSubmit={save}>
    {wizard && <ol className="setup-steps" aria-label="配置进度"><li className={step === 1 ? 'active' : 'complete'} aria-current={step === 1 ? 'step' : undefined}><span>{step > 1 ? <Check size={15} /> : '01'}</span>模组目录</li><li className={step === 2 ? 'active' : ''} aria-current={step === 2 ? 'step' : undefined}><span>02</span>游戏版本</li></ol>}
    {(!wizard || step === 1) && <section className="directory-field">
      {wizard && <div className="step-copy"><h2>连接你的模组目录</h2><p>输入面板所在机器上的目录，检查文件列表后继续。</p></div>}
      <label className="field">模组目录<div className="input-action"><input aria-label="模组目录" value={draft.modsDirectory} onChange={e => changePath(e.target.value)} placeholder="例如 C:\Minecraft\mods 或 /srv/minecraft/mods" disabled={saving} autoComplete="off" spellCheck={false} /><button type="button" onClick={checkDirectory} disabled={checking || saving || !draft.modsDirectory.trim()}>{checking ? <><LoaderCircle size={15} className="spin" />检查中</> : confirmed === draft.modsDirectory && confirmed ? '已确认' : listing ? '确认' : '检查'}</button></div></label>
      {directoryError && <p className="form-error" role="alert">{directoryError}</p>}
      {listing && !listing.writable && <p className="form-warning" role="alert">目录可以读取，但面板没有写入权限：可以查看和下载模组，开关与分类调整将无法生效。请授予运行用户对该目录（含 client-only）的写权限后重新检查。</p>}
      {listing && <div className="directory-preview"><div className="preview-heading"><span><Check size={14} />{listing.writable ? '目录可读写' : '目录只读'}</span><span>{listing.entries.length} 个条目</span></div>{listing.entries.length ? <ul aria-label="目录文件列表">{listing.entries.map(entry => <li key={entry.name}>{entry.type === 'directory' ? <Folder size={15} /> : <File size={15} />}<span>{entry.name}</span><small>{entry.type === 'directory' ? '目录' : entry.type === 'link' ? '链接' : '文件'}</small></li>)}</ul> : <p className="empty-directory">这是一个空目录，可以继续。</p>}</div>}
      {!listing && <p className="field-help">使用绝对路径。只检查当前层级和写入权限，不会修改目录中的已有文件。</p>}
    </section>}
    {(!wizard || step === 2) && <>
      {wizard && <div className="step-copy"><h2>选择游戏环境</h2><p>设置 Minecraft 和模组加载器，随时可以在设置中调整。</p></div>}
      <VersionFields value={draft} change={setDraft} disabled={saving} />
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions">{wizard && <button type="button" className="secondary-button" onClick={() => setStep(1)} disabled={saving}><ArrowLeft size={16} />上一步</button>}<button className="done-button" disabled={saving || !confirmed || confirmed !== draft.modsDirectory || !draft.minecraftVersion.trim()}>{saving ? <LoaderCircle size={17} className="spin" /> : wizard ? <ArrowRight size={17} /> : <Check size={17} />}{saving ? '正在保存…' : wizard ? '完成配置' : '保存配置'}</button></div>
    </>}
  </form>;
}

const displayOptions: { key: keyof DisplaySettings; title: string; description: string }[] = [
  { key: 'showServerMods', title: '显示服务端模组', description: '关闭后前台隐藏服务端模组分类，且不再提供其下载' },
  { key: 'showClientMods', title: '显示客户端模组', description: '关闭后前台隐藏客户端模组分类，且不再提供其下载' },
];
function DisplayForm() {
  const [value, setValue] = useState<DisplaySettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const request = new AbortController();
    api<DisplaySettings>('/admin/display', { signal: request.signal }).then(setValue)
      .catch(failure => { if (!request.signal.aborted) setError(errorMessage(failure)); });
    return () => request.abort();
  }, []);
  async function toggle(key: keyof DisplaySettings) {
    if (!value || busy) return;
    setBusy(true); setError('');
    try { setValue(await api<DisplaySettings>('/admin/display', { method: 'PUT', body: JSON.stringify({ ...value, [key]: !value[key] }) })); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  return <section className="display-settings" aria-label="前台显示">
    {displayOptions.map(option => <div className="setting-row" key={option.key}><div><h3>{option.title}</h3><p>{option.description}</p></div>
      <button type="button" className="mod-switch" role="switch" aria-checked={value?.[option.key] ?? false} aria-label={option.title} disabled={!value || busy} onClick={() => toggle(option.key)}><span /></button></div>)}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}

export function SettingsDialog({ config, close, saved, theme, toggleTheme }: {
  config: PanelConfig; close: () => void; saved: (value: PanelConfig) => void; theme: 'dark' | 'light'; toggleTheme: () => void;
}) {
  return <Modal title="后台设置" kicker="WORKSPACE SETTINGS" close={close} wide>
    <ConfigForm initial={config} saved={saved} />
    <DisplayForm />
    <div className="setting-row"><div><h3>界面主题</h3><p>保存在当前浏览器中</p></div><button className="theme-choice" onClick={toggleTheme}>{theme === 'dark' ? <Moon size={16} /> : <Sun size={16} />}{theme === 'dark' ? '深色' : '浅色'}</button></div>
    <button className="text-button cancel-settings" onClick={close}>取消并关闭</button>
  </Modal>;
}
