import { useEffect, useId, useRef, useState } from 'react';
import { ArrowDownToLine } from 'lucide-react';

export default function DownloadCard({ urls, loading, error, active }: {
  urls: string[]; loading: boolean; error: string; active: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const statusId = useId();
  useEffect(() => {
    const cancel = () => {
      window.clearTimeout(timer.current);
      running.current = false;
      setBusy(false);
    };
    if (!active) cancel();
    window.addEventListener('pagehide', cancel);
    return () => {
      window.clearTimeout(timer.current);
      running.current = false;
      window.removeEventListener('pagehide', cancel);
    };
  }, [active]);

  const disabled = !active || busy || loading || !!error || !urls.length;
  const status = error ? `模组列表加载失败：${error}` : loading ? '正在读取模组列表…'
    : !urls.length ? '暂无可下载的双端模组。' : '';
  function download() {
    if (disabled || running.current) return;
    const queue = [...urls];
    running.current = true;
    setBusy(true);
    let index = 0;
    const next = () => {
      if (!running.current) return;
      const link = document.createElement('a');
      link.href = queue[index++];
      link.download = '';
      link.hidden = true;
      document.body.append(link);
      link.click();
      link.remove();
      // Dispatching a link does not tell us whether the browser saved the file.
      if (index < queue.length) timer.current = window.setTimeout(next, 300);
      else { running.current = false; setBusy(false); }
    };
    next();
  }
  return <>
    <button className="download-card" onClick={download} disabled={disabled} aria-describedby={status ? statusId : undefined}>
      <span className="pixel-corner corner-one" /><ArrowDownToLine size={62} strokeWidth={1.8} />
      <strong>下载全部</strong><span className="download-subtitle">需要多重下载权限</span><span className="pixel-corner corner-two" />
    </button>
    {status && <p className="download-status" id={statusId} role="status">{status}</p>}
  </>;
}
