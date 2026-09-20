import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { ArrowDownToLine, CircleCheck, LoaderCircle, TriangleAlert } from 'lucide-react';
import { wait, type DownloadFile, type DownloadHandle } from './downloads';

// idle → connecting (clicked, no row has answered yet) → downloading (a row is receiving bytes) → done.
export type DownloadPhase = 'idle' | 'connecting' | 'downloading' | 'done';
type Progress = { total: number; finished: number; failed: number; ratio: number };

const START_GAP = 300;
const DONE_HOLD = 2500;
const empty: Progress = { total: 0, finished: 0, failed: 0, ratio: 0 };

// The card downloads nothing itself: it runs the mod rows' own downloads in list order, one at a time,
// so every file goes through the same path as a click on that row and the row shows its own progress.
export default function DownloadCard({ files, loading, error, active, handleOf }: {
  files: DownloadFile[]; loading: boolean; error: string; active: boolean;
  handleOf: (url: string) => DownloadHandle | undefined;
}) {
  const [phase, setPhase] = useState<DownloadPhase>('idle');
  const [progress, setProgress] = useState<Progress>(empty);
  const run = useRef<AbortController | null>(null);
  const current = useRef<DownloadHandle | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const statusId = useId();
  useEffect(() => {
    const stop = () => {
      window.clearTimeout(timer.current);
      run.current?.abort();
      run.current = null;
      current.current?.abort();
      current.current = null;
    };
    const cancel = () => { stop(); setPhase('idle'); setProgress(empty); };
    if (!active) cancel();
    window.addEventListener('pagehide', cancel);
    return () => { stop(); window.removeEventListener('pagehide', cancel); };
  }, [active]);

  const busy = phase === 'connecting' || phase === 'downloading';
  const disabled = !active || busy || loading || !!error || !files.length;
  const status = error ? `模组列表加载失败：${error}` : loading ? '正在读取模组列表…'
    : busy ? `正在下载 ${progress.finished + progress.failed}/${progress.total} 个模组`
    : phase === 'done' ? (progress.failed ? `${progress.failed} 个模组下载失败，其余 ${progress.finished} 个已保存。` : `已下载 ${progress.finished} 个模组。`)
    : !files.length ? '暂无可下载的双端模组。' : '';

  async function download() {
    if (disabled || run.current) return;
    window.clearTimeout(timer.current);
    const queue = [...files];
    const controller = new AbortController();
    const { signal } = controller;
    run.current = controller;
    let finished = 0, failed = 0, ratio = 0, frame = 0, answered = false;
    const flush = () => {
      frame = 0;
      if (signal.aborted) return;
      setProgress({ total: queue.length, finished, failed, ratio: (finished + failed + ratio) / queue.length });
    };
    // Coalesce per-chunk updates to one render per frame.
    const report = () => { if (!frame) frame = requestAnimationFrame(flush); };
    setPhase('connecting');
    setProgress({ ...empty, total: queue.length });

    for (const [index, file] of queue.entries()) {
      if (signal.aborted) break;
      // Browsers drop downloads dispatched back to back, so a row only starts a beat after the last one saved.
      if (index) await wait(START_GAP, signal);
      if (signal.aborted) break;
      const handle = handleOf(file.url);
      ratio = 0;
      // A mod that left the list while the queue was running no longer has a row to download from.
      if (!handle) { failed++; report(); continue; }
      current.current = handle;
      let saved = false;
      try {
        saved = await handle.run(value => {
          ratio = value;
          if (!answered) { answered = true; setPhase('downloading'); }
          report();
        });
      } catch { /* A row that throws counts like one that could not save. */ }
      current.current = null;
      ratio = 0;
      if (saved) finished++; else failed++;
      report();
    }
    if (signal.aborted) return;
    cancelAnimationFrame(frame);
    flush();
    run.current = null;
    setPhase('done');
    timer.current = window.setTimeout(() => { setPhase('idle'); setProgress(empty); }, DONE_HOLD);
  }

  const percent = Math.round(progress.ratio * 100);
  const icon = phase === 'connecting' ? <LoaderCircle size={62} strokeWidth={1.8} className="spin" />
    : phase === 'done' ? progress.failed ? <TriangleAlert size={62} strokeWidth={1.8} /> : <CircleCheck size={62} strokeWidth={1.8} />
    : <ArrowDownToLine size={62} strokeWidth={1.8} />;
  const title = phase === 'connecting' ? '正在连接' : phase === 'downloading' ? `${percent}%`
    : phase === 'done' ? progress.failed ? '部分失败' : '下载完成' : '下载全部';
  const subtitle = busy ? `${progress.finished + progress.failed} / ${progress.total} 个模组`
    : phase === 'done' ? `已保存 ${progress.finished} 个` : '需要多重下载权限';
  return <>
    <button className="download-card" data-phase={phase} onClick={download} disabled={disabled} aria-busy={busy || undefined}
      aria-describedby={status ? statusId : undefined} style={{ '--progress': progress.ratio } as CSSProperties}>
      <span className="pixel-corner corner-one" />{icon}
      <strong>{title}</strong><span className="download-subtitle">{subtitle}</span><span className="pixel-corner corner-two" />
      {phase !== 'idle' && <span className="download-progress" aria-hidden="true"><span /></span>}
    </button>
    {status && <p className="download-status" id={statusId} role="status">{status}</p>}
  </>;
}
