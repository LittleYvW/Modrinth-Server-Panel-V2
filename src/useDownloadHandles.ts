import { useCallback, useRef } from 'react';
import type { DownloadHandle, RegisterDownload } from './downloads';

// Keyed by download URL, which is unique per mod and already carried by every row and by the batch queue.
// Rows come and go with the live list, so a handle is only ever looked up while its row is mounted.
export function useDownloadHandles() {
  const handles = useRef(new Map<string, DownloadHandle>());
  const register = useCallback<RegisterDownload>((url, handle) => {
    handles.current.set(url, handle);
    // A remounted row registers before the old one cleans up, so only drop the handle still on file.
    return () => { if (handles.current.get(url) === handle) handles.current.delete(url); };
  }, []);
  const handleOf = useCallback((url: string) => handles.current.get(url), []);
  return { register, handleOf };
}
