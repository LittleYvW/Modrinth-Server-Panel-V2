export type DownloadFile = { url: string; name: string };
// A fetched file ready to save: a blob URL, or the original URL when the browser must fetch it natively.
export type Fetched = { href: string; name: string; blob: boolean };

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

/**
 * Downloads a file through fetch so callers can observe it. `onStart` fires once response headers arrive and
 * `onProgress` with a 0–1 ratio per chunk when the size is known. Resolves null on an HTTP failure and rejects
 * only when `signal` aborts.
 */
export async function fetchFile(file: DownloadFile, signal: AbortSignal, onStart: () => void, onProgress: (ratio: number) => void): Promise<Fetched | null> {
  let res: Response;
  try {
    res = await fetch(file.url, { signal });
  } catch (error) {
    if (signal.aborted) throw error;
    // No CORS on a custom mirror (or similar): let the browser download it natively instead.
    return { href: file.url, name: '', blob: false };
  }
  signal.throwIfAborted();
  onStart();
  try {
    if (!res.ok || !res.body) return null;
    const total = Number(res.headers.get('Content-Length')) || 0;
    const reader = res.body.getReader();
    const chunks: BlobPart[] = [];
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      bytes += value.length;
      if (total) onProgress(Math.min(bytes / total, 1));
    }
    const blob = new Blob(chunks, { type: 'application/java-archive' });
    return { href: URL.createObjectURL(blob), name: fileNameOf(res, file.name), blob: true };
  } catch (error) {
    if (signal.aborted) throw error;
    return null;
  }
}

export function saveFile({ href, name, blob }: Fetched) {
  const link = document.createElement('a');
  link.href = href;
  link.download = name;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  if (blob) window.setTimeout(() => URL.revokeObjectURL(href), 60_000);
}

export function discardFile({ href, blob }: Fetched) {
  if (blob) URL.revokeObjectURL(href);
}

export const wait = (ms: number, signal: AbortSignal) => new Promise<void>(resolve => {
  const id = window.setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { window.clearTimeout(id); resolve(); }, { once: true });
});
