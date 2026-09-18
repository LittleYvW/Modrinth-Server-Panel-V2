import { useEffect, useState, type FormEvent } from 'react';
import { ArrowDownToLine, Link2, Link2Off, LoaderCircle, RefreshCw, Settings2, TriangleAlert } from 'lucide-react';
import { Cube } from './Artwork';
import Modal from './Modal';
import DownloadCard from './DownloadCard';
import { api, errorMessage } from './api';
import { modSideNames, modSides, type AdminMod, type AdminModList, type ModSide, type ModUpdate, type PublicMod, type PublicModList } from '../shared/types';
import { useModList } from './useMods';

const groups: ModSide[] = ['both', 'server', 'client'];
const sourceNames: Record<AdminMod['categorySource'], string> = {
  manual: '手动指定', 'version-environment': '版本环境', 'project-environment': '项目环境',
  'legacy-fields': '项目端侧字段', location: '当前目录', default: '默认双端',
};
const downloadPath = (id: string) => `/api/public/mods/${encodeURIComponent(id)}/download`;

function ModIcon({ mod }: { mod: PublicMod }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [mod.iconUrl]);
  return <div className="mod-icon">{mod.iconUrl && !broken
    ? <img src={mod.iconUrl} alt="" loading="lazy" onError={() => setBroken(true)} />
    : <Cube />}</div>;
}

function Panel({ side, count, children }: { side: ModSide; count: number; children: React.ReactNode }) {
  return <section className={`mods-panel side-panel side-${side}`} aria-labelledby={`mods-${side}`}>
    <div className="panel-heading"><h2 id={`mods-${side}`}><Cube />{modSideNames[side]}</h2><span>{count} 个模组</span></div>
    {children}
  </section>;
}

export function PublicMods({ active = true }: { active?: boolean }) {
  const { data, error, loading } = useModList<PublicModList>('/public/mods', true);
  const mods = data?.mods ?? [];
  return <><DownloadCard files={mods.filter(mod => mod.side === 'both').map(mod => ({ url: downloadPath(mod.id), name: `${mod.name}.jar` }))}loading={!data && !error || loading} error={error} active={active} /><div className="mod-sections">{groups.map(side => {
    const group = mods.filter(mod => mod.side === side);
    return <Panel key={side} side={side} count={group.length}>
      {group.length ? <ul className="mod-list">{group.map(mod => <li className="mod-row" key={mod.id}>
        <ModIcon mod={mod} />
        <div className="mod-info"><h3>{mod.name}</h3><p>{mod.description || '未在 Modrinth 上识别到该模组，使用文件名显示。'}</p></div>
        <span className="mod-version">{mod.version ? `v${mod.version}` : '—'}</span>
        <a className="icon-button mod-download" href={downloadPath(mod.id)} aria-label={`下载 ${mod.name}`}><ArrowDownToLine size={23} /></a>
      </li>)}</ul>
        : <p className="mod-empty">{error ? error : loading && !data ? '正在读取模组列表…' : '该分类暂无已开启的模组。'}</p>}
    </Panel>;
  })}</div></>;
}

function ConfigDialog({ mod, close, saved }: { mod: AdminMod; close: () => void; saved: (value: AdminMod) => void }) {
  const [projectId, setProjectId] = useState(mod.projectId ?? '');
  const [downloadUrl, setDownloadUrl] = useState(mod.downloadUrl ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      saved(await api<AdminMod>(`/admin/mods/${encodeURIComponent(mod.id)}`, {
        method: 'PATCH', body: JSON.stringify({ projectId: projectId.trim() || null, downloadUrl: downloadUrl.trim() || null } satisfies ModUpdate),
      }));
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  return <Modal title="模组配置" kicker="MOD BINDING" close={close}>
    <form className="admin-form" onSubmit={submit}>
      <p className="form-description">{mod.fileName} · 仅未绑定的模组可以手动关联项目与下载地址；关联只提供展示信息，不改变分类或开关。</p>
      <label className="field">Modrinth 项目 ID 或 slug <span className="optional">可选</span>
        <input value={projectId} onChange={event => setProjectId(event.target.value)} placeholder="例如 sodium" maxLength={64} disabled={busy} autoComplete="off" spellCheck={false} /></label>
      <label className="field">下载地址 <span className="optional">可选</span>
        <input value={downloadUrl} onChange={event => setDownloadUrl(event.target.value)} placeholder="留空则由面板直接提供文件" maxLength={2048} disabled={busy} autoComplete="off" spellCheck={false} inputMode="url" /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions"><button className="done-button" disabled={busy}>{busy ? <LoaderCircle size={17} className="spin" /> : <Link2 size={17} />}{busy ? '正在保存…' : '保存配置'}</button></div>
    </form>
  </Modal>;
}

function AdminRow({ mod, busy, act, configure }: {
  mod: AdminMod; busy: boolean; act: (id: string, run: () => Promise<AdminMod>) => void; configure: (mod: AdminMod) => void;
}) {
  const bound = mod.binding === 'bound';
  const patch = (body: ModUpdate) => api<AdminMod>(`/admin/mods/${encodeURIComponent(mod.id)}`, { method: 'PATCH', body: JSON.stringify(body) });
  return <li className={`mod-row admin-mod-row${mod.enabled ? '' : ' mod-closed'}`}>
    <ModIcon mod={mod} />
    <div className="mod-info">
      <h3>{mod.name}{mod.version && <span className="mod-tag">v{mod.version}</span>}</h3>
      <p title={mod.fileName}>{mod.fileName}</p>
      <div className="mod-state">
        <span className={bound ? 'binding-bound' : 'binding-loose'}>{bound ? <Link2 size={12} /> : <Link2Off size={12} />}{bound ? '已绑定 Modrinth' : mod.resolving ? '识别中…' : '未绑定'}</span>
        <span className="mod-source">{sourceNames[mod.categorySource]}</span>
        {mod.error && <span className="mod-problem"><TriangleAlert size={12} />{mod.error}</span>}
      </div>
    </div>
    <div className="mod-controls">
      <label className="switch-field"><span>{mod.enabled ? '已开启' : '已关闭'}</span>
        <button type="button" className="mod-switch" role="switch" aria-checked={mod.enabled} aria-label={`启用 ${mod.name}`} disabled={busy}
          onClick={() => act(mod.id, () => patch({ enabled: !mod.enabled }))}><span /></button></label>
      <label className="field compact-field"><span className="visually-hidden">{`分类 ${mod.name}`}</span>
        <select value={mod.manualSide ?? 'auto'} aria-label={`分类 ${mod.name}`} disabled={busy}
          onChange={event => act(mod.id, () => patch({ side: event.target.value === 'auto' ? null : event.target.value as ModSide }))}>
          <option value="auto">自动（{modSideNames[mod.side]}）</option>
          {modSides.map(side => <option key={side} value={side}>{modSideNames[side]}</option>)}
        </select></label>
      <div className="mod-actions">
        <button type="button" className="icon-button" aria-label={`配置 ${mod.name}`} title={bound ? '取消绑定后可手动配置' : '手动配置项目与下载地址'} disabled={busy || bound} onClick={() => configure(mod)}><Settings2 size={18} /></button>
        {bound
          ? <button type="button" className="icon-button" aria-label={`取消绑定 ${mod.name}`} title="取消绑定" disabled={busy}
            onClick={() => act(mod.id, () => api<AdminMod>(`/admin/mods/${encodeURIComponent(mod.id)}/unbind`, { method: 'POST', body: '{}' }))}><Link2Off size={18} /></button>
          : <button type="button" className="icon-button" aria-label={`重新识别绑定 ${mod.name}`} title="重新识别绑定" disabled={busy}
            onClick={() => act(mod.id, () => api<AdminMod>(`/admin/mods/${encodeURIComponent(mod.id)}/resolve`, { method: 'POST', body: '{}' }))}><RefreshCw size={18} className={busy ? 'spin' : undefined} /></button>}
      </div>
    </div>
  </li>;
}

export function AdminMods({ notify }: { notify: (name: string, text: string) => void }) {
  const { data, error, loading, refresh, replace } = useModList<AdminModList>('/admin/mods', true);
  const [working, setWorking] = useState<string[]>([]);
  const [configuring, setConfiguring] = useState<AdminMod | null>(null);
  const mods = data?.mods ?? [];
  function apply(updated: AdminMod) {
    replace(current => current ? { ...current, mods: current.mods.map(mod => mod.id === updated.id ? updated : mod) } : current);
  }
  function act(id: string, run: () => Promise<AdminMod>) {
    if (working.includes(id)) return;
    setWorking(current => [...current, id]);
    run().then(apply)
      // The panel shows what the files actually are, so a failure refetches instead of guessing.
      .catch(failure => { notify('操作未完成', errorMessage(failure)); refresh(); })
      .finally(() => setWorking(current => current.filter(value => value !== id)));
  }
  if (error && !data) return <div className="workspace-message"><p className="form-error" role="alert">{error}</p><button className="secondary-button" onClick={refresh}>重试</button></div>;
  if (!data) return <div className="workspace-message"><LoaderCircle className="spin" size={24} /><p>正在读取模组目录…</p></div>;
  return <div className="admin-mods">
    <div className="mods-toolbar">
      <p>{data.scanning ? '正在扫描模组目录…' : `共 ${mods.length} 个模组，其中 ${mods.filter(mod => mod.enabled).length} 个已开启。`}</p>
      <button type="button" className="text-button" onClick={refresh} disabled={loading}><RefreshCw size={13} />刷新列表</button>
    </div>
    {groups.map(side => {
      const group = mods.filter(mod => mod.side === side);
      return <Panel key={side} side={side} count={group.length}>
        {group.length ? <ul className="mod-list">{group.map(mod =>
          <AdminRow key={mod.id} mod={mod} busy={working.includes(mod.id)} act={act} configure={setConfiguring} />)}</ul>
          : <p className="mod-empty">{data.scanning ? '正在扫描…' : '该分类暂无模组。'}</p>}
      </Panel>;
    })}
    {configuring && <ConfigDialog mod={mods.find(mod => mod.id === configuring.id) ?? configuring} close={() => setConfiguring(null)}
      saved={updated => { apply(updated); setConfiguring(null); notify('配置已保存', `${updated.name} 的手动配置已更新。`); }} />}
  </div>;
}
