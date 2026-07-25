import { useCallback, useEffect, useRef, useState } from 'react';
import { readCache, writeCache } from './cache';

// A free-tier host spins its container down when idle, so the first
// request after a quiet spell spends most of a minute booting. Past this
// point the UI stops presenting it as an ordinary load and says what is
// actually happening, because a spinner that never resolves reads as
// broken.
const WAKE_HINT_MS = 4000;

/**
 * Loads a resource, showing cached data immediately and reporting which
 * of the several "there's nothing on screen" situations you're actually
 * in. Before this, a failed fetch and an genuinely empty gym list
 * rendered identically.
 *
 * `fetcher` must be referentially stable — wrap it in useCallback in the
 * caller, or the effect below re-runs on every render.
 *
 * phase:
 *   'loading' — request in flight, nothing shown yet
 *   'waking'  — still in flight past WAKE_HINT_MS; host is probably cold
 *   'ready'   — data is fresh from the server
 *   'error'   — request failed; `data` may still hold cached values
 */
export function useCachedResource(cacheKey, fetcher) {
  // Read the cache during the first render rather than in an effect, so
  // the initial paint already has data instead of flashing skeletons.
  const [initial] = useState(() => readCache(cacheKey));

  const [data, setData] = useState(initial?.data ?? null);
  const [savedAt, setSavedAt] = useState(initial?.savedAt ?? null);
  const [isStale, setIsStale] = useState(Boolean(initial));
  const [phase, setPhase] = useState('loading');
  const [error, setError] = useState(null);

  // Marks the newest request so a slow earlier one landing late can't
  // overwrite a newer result. Checked instead of an is-mounted flag,
  // which StrictMode's double-mount makes awkward to keep accurate.
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    setPhase('loading');
    setError(null);

    const wakeHint = setTimeout(() => {
      if (requestRef.current === requestId) setPhase('waking');
    }, WAKE_HINT_MS);

    try {
      const fresh = await fetcher();
      if (requestRef.current !== requestId) return;
      setData(fresh);
      setSavedAt(Date.now());
      setIsStale(false);
      setPhase('ready');
      writeCache(cacheKey, fresh);
    } catch (err) {
      if (requestRef.current !== requestId) return;
      // Keep whatever `data` already holds. Cached values with an
      // explicit "saved N ago" label beat wiping the screen on a blip.
      setError(err);
      setIsStale(true);
      setPhase('error');
    } finally {
      clearTimeout(wakeHint);
    }
  }, [cacheKey, fetcher]);

  useEffect(() => {
    load();
  }, [load]);

  // setData is exposed so callers can fold in live WebSocket updates
  // without a refetch; those don't change staleness or phase.
  return { data, savedAt, isStale, phase, error, reload: load, setData };
}
