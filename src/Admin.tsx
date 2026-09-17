import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Check, File, Folder, KeyRound, LoaderCircle, Moon, RefreshCw, Sun } from 'lucide-react';
import { loaders, loaderNames, type AuthStatus, type DirectoryListing, type PanelConfig, type VersionList } from '../shared/types';
import { api, ApiError, errorMessage } from './api';
import Modal from './Modal';
import type { DialogTransition } from './useDialogTransition';

export function AuthDialog({ close, authenticated, transition }: { close: () => void; authenticated: (status: AuthStatus) => void; transition?: DialogTransition }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
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
  useEffect(() => { load(); return () => controller.current?.abort(); }, []); // Initial status determines registration vs login.
  useEffect(() => { if (status) passwordRef.current?.focus(); }, [status]);
  const register = status && !status.registered;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!status || busy || accepted.current || transition) return;
    if (register && password !== confirm) { setError('两次输入的密码不一致。'); return; }
    setBusy(true); setError('');
    const request = new AbortController(); controller.current = request;
    try {
      const result = await api<AuthStatus>(register ? '/auth/register' : '/auth/login', { method: 'POST', body: JSON.stringify({ password }), signal: request.signal });
      if (!request.signal.aborted) accept(result);
    } catch (error) {
      if (request.signal.aborted) return;
      if (error instanceof ApiError && error.status === 409) {
        try { setStatus(await api<AuthStatus>('/auth/status', { signal: request.signal })); setConfirm(''); }
        catch { /* Preserve original conflict message; retry remains available. */ }
      }
      setError(errorMessage(error));
    } finally { setBusy(false); }
  }
  return <Modal title={status ? register ? '管理员注册' : '管理员登录' : '管理员验证'} kicker="ADMIN ACCESS" close={close} entrance transition={transition} onCloseStart={() => { accepted.current = true; controller.current?.abort(); }}>
    {!status ? <div className="form-intro"><p>{error || '正在连接管理服务…'}</p>{error && <button className="secondary-button" onClick={load}>重试</button>}</div> : <form className="admin-form" onSubmit={submit}>
      <p className="form-description">{register ? '首次使用，请创建管理员密码，开启你的模组工作空间。' : '输入管理员密码，继续管理你的模组工作空间。'}</p>
      <label className="field">{register ? '设置密码' : '管理员密码'}<input ref={passwordRef} type="password" autoComplete={register ? 'new-password' : 'current-password'} minLength={register ? 8 : undefined} maxLength={256} required value={password} onChange={e => setPassword(e.target.value)} placeholder={register ? '至少 8 个字符' : '输入密码'} disabled={busy} /></label>
      {register && <label className="field">确认密码<input type="password" autoComplete="new-password" minLength={8} maxLength={256} required value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="再次输入密码" disabled={busy} /></label>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="done-button" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : <KeyRound size={18} />}{busy ? '正在验证…' : register ? '注册' : '登录'}</button>
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
      {listing && <div className="directory-preview"><div className="preview-heading"><span><Check size={14} />目录可读取</span><span>{listing.entries.length} 个条目</span></div>{listing.entries.length ? <ul aria-label="目录文件列表">{listing.entries.map(entry => <li key={entry.name}>{entry.type === 'directory' ? <Folder size={15} /> : <File size={15} />}<span>{entry.name}</span><small>{entry.type === 'directory' ? '目录' : entry.type === 'link' ? '链接' : '文件'}</small></li>)}</ul> : <p className="empty-directory">这是一个空目录，可以继续。</p>}</div>}
      {!listing && <p className="field-help">使用绝对路径。只检查当前层级，不会修改目录中的文件。</p>}
    </section>}
    {(!wizard || step === 2) && <>
      {wizard && <div className="step-copy"><h2>选择游戏环境</h2><p>设置 Minecraft 和模组加载器，随时可以在设置中调整。</p></div>}
      <VersionFields value={draft} change={setDraft} disabled={saving} />
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions">{wizard && <button type="button" className="secondary-button" onClick={() => setStep(1)} disabled={saving}><ArrowLeft size={16} />上一步</button>}<button className="done-button" disabled={saving || !confirmed || confirmed !== draft.modsDirectory || !draft.minecraftVersion.trim()}>{saving ? <LoaderCircle size={17} className="spin" /> : wizard ? <ArrowRight size={17} /> : <Check size={17} />}{saving ? '正在保存…' : wizard ? '完成配置' : '保存配置'}</button></div>
    </>}
  </form>;
}

function PasswordForm({ changed }: { changed: () => void }) {
  const [currentPassword, setCurrent] = useState(''); const [newPassword, setNew] = useState(''); const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    if (newPassword !== confirm) { setError('两次输入的新密码不一致。'); return; }
    setBusy(true); setError('');
    try { await api('/auth/password', { method: 'PUT', body: JSON.stringify({ currentPassword, newPassword }) }); changed(); }
    catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  }
  return <form className="admin-form password-form" onSubmit={submit}><h3>修改管理员密码</h3><p className="form-description">更新后需要重新登录。</p>
    <label className="field">当前密码<input type="password" autoComplete="current-password" required value={currentPassword} onChange={e => setCurrent(e.target.value)} disabled={busy} /></label>
    <div className="form-columns"><label className="field">新密码<input type="password" autoComplete="new-password" minLength={8} maxLength={256} placeholder="至少 8 个字符" required value={newPassword} onChange={e => setNew(e.target.value)} disabled={busy} /></label><label className="field">确认新密码<input type="password" autoComplete="new-password" minLength={8} maxLength={256} required value={confirm} onChange={e => setConfirm(e.target.value)} disabled={busy} /></label></div>
    {error && <p className="form-error" role="alert">{error}</p>}<button className="secondary-button" disabled={busy}>{busy ? '正在更新…' : '更新密码'}</button>
  </form>;
}

export function SettingsDialog({ config, close, saved, theme, toggleTheme, passwordChanged }: {
  config: PanelConfig; close: () => void; saved: (value: PanelConfig) => void; theme: 'dark' | 'light'; toggleTheme: () => void; passwordChanged: () => void;
}) {
  return <Modal title="后台设置" kicker="WORKSPACE SETTINGS" close={close} wide>
    <ConfigForm initial={config} saved={saved} />
    <div className="setting-row"><div><h3>界面主题</h3><p>保存在当前浏览器中</p></div><button className="theme-choice" onClick={toggleTheme}>{theme === 'dark' ? <Moon size={16} /> : <Sun size={16} />}{theme === 'dark' ? '深色' : '浅色'}</button></div>
    <PasswordForm changed={passwordChanged} />
    <button className="text-button cancel-settings" onClick={close}>取消并关闭</button>
  </Modal>;
}
