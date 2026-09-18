import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { ArrowDownToLine, CircleCheck, LoaderCircle, TriangleAlert } from 'lucide-react';

export type DownloadFile = { url: string; name: string };
// idle → connecting (clicked, no response headers yet) → downloading (bytes arriving) → done.
export type DownloadPhase = 'idle' | 'connecting' | 'downloading' | 'done';
type Progress = { total: number; finished: number; failed: number; ratio: number };

const CONCURRENCY = 3;
const SAVE_GAP = 300;
const DONE_HOLD = 2500;
const empty: Progress = { total: 0, finished: 0, failed: 0, ratio: 0 };

const wait = (ms: number, signal: AbortSignal) => new Promise<void>(resolve => {
  const id = window.setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { window.clearTimeout(id); resolve(); }, { once: true });
});

function clickLink(href: string, name: string) {
  const link = document.createElement('a');
  link.href = href;
  link.download = name;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
}

// Cross-origin responses hide Content-Disposition, so CDN files fall back to the URL's last segment.
export function fileNameOf(res: Response, fallback: string) {
  const header = res.headers.get('Content-Disposition') ?? '';
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1];
  const plain = /filename="([^"]+)"/i.exec(header)?.[1];
  const segment = res.url ? new URL(res.url, location.href).pathname.split('/').pop() : '';
  for (const candidate of [encoded, plain, segment]) {
    if (!candidate) continue;
    try {
      const name = decodeURIComponent(candidate);
      if (candidate !== segment || name.toLowerCase().endsWith('.jar')) return name;
    } catch { /* malformed escape, try the next source */ }
  }
  return fallback;
}

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
    const save = (href: string, name: string, revoke: boolean) => {
      saving = saving.then(async () => {
        if (saved++) await wait(SAVE_GAP, signal);
        if (revoke) window.setTimeout(() => URL.revokeObjectURL(href), 60_000);
        if (!signal.aborted) clickLink(href, name);
      });
    };

    const worker = async () => {
      while (!signal.aborted && next < queue.length) {
        const index = next++;
        const file = queue[index];
        let res: Response;
        try {
          res = await fetch(file.url, { signal });
        } catch {
          if (signal.aborted) return;
          // No CORS on a custom mirror (or similar): let the browser download it natively instead.
          ratios[index] = 1; finished++; report();
          save(file.url, '', false);
          continue;
        }
        if (signal.aborted) return;
        setPhase('downloading');
        try {
          if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
          const total = Number(res.headers.get('Content-Length')) || 0;
          const reader = res.body.getReader();
          const chunks: BlobPart[] = [];
          let bytes = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            bytes += value.length;
            if (total) { ratios[index] = Math.min(bytes / total, 1); report(); }
          }
          ratios[index] = 1; finished++; report();
          save(URL.createObjectURL(new Blob(chunks, { type: 'application/java-archive' })), fileNameOf(res, file.name), true);
        } catch {
          if (signal.aborted) return;
          ratios[index] = 1; failed++; report();
        }
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
