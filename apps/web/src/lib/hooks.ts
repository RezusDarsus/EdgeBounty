'use client';
import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import { api } from './api';
import { useSession } from '@/app/providers';

/** Loads an API resource; `reload` re-fetches. `path === null` skips loading. */
export function useApi<T = any>(path: string | null, deps: unknown[] = []) {
  const { account } = useSession();
  const resourceKey = `${account?.id ?? 'anonymous'}:${path ?? ''}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const requestGeneration = useRef(0);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(!!path);
  const load = useCallback(async () => {
    const generation = ++requestGeneration.current;
    if (!path) { setData(null); setError(null); setLoading(false); setLoadedKey(resourceKey); return; }
    setLoading(true);
    try {
      const result = await api<T>(path);
      if (generation !== requestGeneration.current) return;
      setData(result);
      setError(null);
      setLoadedKey(resourceKey);
    } catch (e) {
      if (generation === requestGeneration.current) { setError(e); setLoadedKey(resourceKey); }
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, resourceKey, ...deps]);
  useEffect(() => {
    setData(null); setError(null);
    void load();
    return () => { requestGeneration.current++; };
  }, [load]);
  const updateData = useCallback((value: SetStateAction<T | null>) => { setLoadedKey(resourceKey); setData(value); }, [resourceKey]);
  return { data: loadedKey === resourceKey ? data : null, error: loadedKey === resourceKey ? error : null, loading: loadedKey !== resourceKey ? !!path : loading, reload: load, setData: updateData };
}
