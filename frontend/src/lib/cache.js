// Last-known API responses, kept in localStorage so a cold start has
// something real to show.
//
// This exists because of how the app is hosted. A free-tier container
// spins down when idle and can take most of a minute to boot, and sw.js
// deliberately caches only the static shell — never API data — from back
// when the backend was always a laptop on the same WiFi. Without a cache
// the app renders an empty list while the server wakes, which looks
// exactly like "this gym has no machines".

const PREFIX = 'gympulse_cache:';

export function readCache(key) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const { data, savedAt } = JSON.parse(raw);
    if (data === undefined || !savedAt) return null;
    return { data, savedAt };
  } catch {
    // An unparseable entry is no more useful than a missing one, and a
    // cache read must never be what breaks the page.
    return null;
  }
}

export function writeCache(key, data) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ data, savedAt: Date.now() }));
  } catch {
    // Quota exceeded, or storage blocked entirely in private mode. The
    // cache is an optimisation, never a requirement.
  }
}

// Rendered next to cached data so it's obvious the reading might be old.
// Deliberately coarse — "3m ago" is the useful part, seconds are noise.
export function formatAge(savedAt) {
  if (!savedAt) return null;
  const seconds = Math.max(0, Math.round((Date.now() - savedAt) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
