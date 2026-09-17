import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from './api';

export const MOD_EVENTS = '/api/public/mods/events';

// One revision stream drives both views; every notification refetches the whole list, so a reconnect
// that replays the current revision recovers anything missed while the connection was down.
export function useModList<T extends { revision: number }>(path: string, active: boolean) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const refresh = useCallback(() => setAttempt(value => value + 1), []);
  useEffect(() => {
    if (!active) { setData(null); setError(''); setLoading(false); return; }
    const request = new AbortController();
    setLoading(true);
    api<T>(path, { signal: request.signal })
      .then(result => { if (!request.signal.aborted) { setData(result); setError(''); } })
      .catch(failure => { if (!request.signal.aborted) setError(errorMessage(failure)); })
      .finally(() => { if (!request.signal.aborted) setLoading(false); });
    return () => request.abort();
  }, [path, active, attempt]);
  useEffect(() => {
    if (!active) return;
    const reload = () => refresh();
    let source: EventSource | undefined;
    if (typeof EventSource !== 'undefined') {
      source = new EventSource(MOD_EVENTS);
      source.addEventListener('mods', reload);
    }
    window.addEventListener('focus', reload);
    return () => { source?.close(); window.removeEventListener('focus', reload); };
  }, [active, refresh]);
  return { data, error, loading, refresh, replace: setData };
}
