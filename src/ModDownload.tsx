import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { ArrowDownToLine, Check, LoaderCircle, TriangleAlert } from 'lucide-react';
import { discardFile, fetchFile, saveFile, type DownloadFile, type Fetched, type RegisterDownload } from './downloads';

// idle → connecting (clicked, no response headers yet) → downloading (bytes arriving) → done | failed → idle.
export type ModDownloadPhase = 'idle' | 'connecting' | 'downloading' | 'done' | 'failed';
const HOLD = { done: 1500, failed: 2500 };
const unwatched = () => { /* A visitor clicking the row watches the button itself. */ };

export default function ModDownload({ file, label, active = true, register }: {
  file: DownloadFile; label: string; active?: boolean; register?: RegisterDownload;
}) {
  const [phase, setPhase] = useState<ModDownloadPhase>('idle');
  const [ratio, setRatio] = useState(0);
  const run = useRef<AbortController | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const cancel = useCallback(() => {
    window.clearTimeout(timer.current);
    run.current?.abort();
    run.current = null;
    setPhase('idle');
    setRatio(0);
  }, []);
  useEffect(() => {
    if (!active) cancel();
    window.addEventListener('pagehide', cancel);
    return () => {
      window.clearTimeout(timer.current);
      run.current?.abort();
      run.current = null;
      window.removeEventListener('pagehide', cancel);
    };
  }, [active, cancel]);

  // Both the row's own button and "download all" go through here, so a batch is just these downloads in turn.
  // `report` mirrors the progress to the caller; it resolves true only once the file is actually handed over.
  async function download(report: (value: number) => void): Promise<boolean> {
    if (run.current || !active) return false;
    window.clearTimeout(timer.current);
    const controller = new AbortController();
    run.current = controller;
    let frame = 0, latest = 0;
    setPhase('connecting');
    setRatio(0);
    let result: Fetched | null;
    try {
      result = await fetchFile(file, controller.signal, () => { setPhase('downloading'); report(0); }, value => {
        latest = value;
        report(value);
        if (!frame) frame = requestAnimationFrame(() => { frame = 0; setRatio(latest); });
      });
    } catch {
      cancelAnimationFrame(frame);
      return false;
    }
    cancelAnimationFrame(frame);
    run.current = null;
    // A save the browser refuses is a failure like any other, and its blob still has to be released.
    let saved = false;
    if (result) {
      try { saveFile(result); saved = true; } catch { discardFile(result); }
    }
    if (saved) { setRatio(1); report(1); }
    const outcome = saved ? 'done' : 'failed';
    setPhase(outcome);
    timer.current = window.setTimeout(() => { setPhase('idle'); setRatio(0); }, HOLD[outcome]);
    return saved;
  }

  // The handle stays stable for as long as the row is mounted, but always calls the current closure.
  const latest = useRef(download);
  latest.current = download;
  useEffect(() => register?.(file.url, { run: report => latest.current(report), abort: cancel }), [register, file.url, cancel]);

  function start(event: MouseEvent<HTMLAnchorElement>) {
    // Modified clicks keep the native link behaviour (new tab, save as…).
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    void download(unwatched);
  }

  const busy = phase === 'connecting' || phase === 'downloading';
  return <a className="icon-button mod-download" data-phase={phase} href={file.url} onClick={start} aria-busy={busy || undefined}
    aria-label={phase === 'failed' ? `${label} 下载失败，点击重试` : `下载 ${label}`} style={{ '--progress': ratio } as CSSProperties}>
    {busy ? <LoaderCircle size={21} className="spin" /> : phase === 'done' ? <Check size={21} /> : phase === 'failed' ? <TriangleAlert size={20} /> : <ArrowDownToLine size={23} />}
    {busy && <svg className="mod-download-ring" viewBox="0 0 40 40" preserveAspectRatio="none" aria-hidden="true">
      <rect x="1" y="1" width="38" height="38" rx="8" pathLength="100" />
    </svg>}
  </a>;
}
