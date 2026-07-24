// Single favorite "home gym" stored client-side only — no backend/account
// needed, matches the app's current no-login model. Swap for a per-user
// backend value if/when real accounts are added.
const KEY = 'gympulse_favorite_gym_id';

export function getFavoriteGymId() {
  const raw = localStorage.getItem(KEY);
  return raw ? Number(raw) : null;
}

export function setFavoriteGymId(id) {
  localStorage.setItem(KEY, String(id));
}

export function clearFavoriteGymId() {
  localStorage.removeItem(KEY);
}

export function toggleFavoriteGym(id) {
  const current = getFavoriteGymId();
  if (current === id) {
    clearFavoriteGymId();
    return null;
  }
  setFavoriteGymId(id);
  return id;
}
