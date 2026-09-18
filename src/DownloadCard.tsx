import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { ArrowDownToLine, CircleCheck, LoaderCircle, TriangleAlert } from 'lucide-react';
import { discardFile, fetchFile, saveFile, wait, type DownloadFile, type Fetched } from './downloads';

// idle → connecting (clicked, no response headers yet) → downloading (bytes arriving) → done.
export type DownloadPhase = 'idle' | 'connecting' | 'downloading' | 'done';
type Progress = { total: number; finished: number; failed: number; ratio: number };

const CONCURRENCY = 3;
const SAVE_GAP = 300;
const DONE_HOLD = 2500;
const empty: Progress = { total: 0, finished: 0, failed: 0, ratio: 0 };

export default function DownloadCard({ files, loading, error, active }: {
  files: DownloadFile[]; loading: boolean; error: string; active: boolean;
}) {
  const [phase, setPhase] = useState<DownloadPhase>('idle');
  const [progress, setProgress] = useState<Progress>(empty);
  const run = useRef<AbortController | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const statusId = useId();
  useEffect(() => {
    const cancel = () => {
      window.clearTimeout(timer.current);
      run.current?.abort();
      run.current = null;
      setPhase('idle');
      setProgress(empty);
    };
    if (!active) cancel();
    window.addEventListener('pagehide', cancel);
    return () => {
      window.clearTimeout(timer.current);
      run.current?.abort();
      run.current = null;
      window.removeEventListener('pagehide', cancel);
    };
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
    const ratios = queue.map(() => 0);
    let finished = 0, failed = 0, next = 0, frame = 0;
    const flush = () => {
      frame = 0;
      if (signal.aborted) return;
      setProgress({ total: queue.length, finished, failed, ratio: ratios.reduce((sum, value) => sum + value, 0) / queue.length });
    };
    // Coalesce per-chunk updates to one render per frame.
    const report = () => { if (!frame) frame = requestAnimationFrame(flush); };
    setPhase('connecting');
    setProgress({ ...empty, total: queue.length });

    // Browsers drop downloads dispatched back to back, so saves stay spaced like the old link queue.
    let saving = Promise.resolve();
    let saved = 0;
    const save = (file: Fetched) => {
      saving = saving.then(async () => {
        if (saved++) await wait(SAVE_GAP, signal);
        if (signal.aborted) discardFile(file);
        else saveFile(file);
      });
    };

    const worker = async () => {
      while (!signal.aborted && next < queue.length) {
        const index = next++;
        let result: Fetched | null;
        try {
          result = await fetchFile(queue[index], signal, () => setPhase('downloading'), ratio => { ratios[index] = ratio; report(); });
        } catch { return; }
        ratios[index] = 1;
        if (result) { finished++; save(result); } else failed++;
        report();
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    await saving;
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
