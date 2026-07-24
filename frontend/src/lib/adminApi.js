const TOKEN_KEY = 'gympulse_admin_token';

export function getAdminToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setAdminToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function adminFetch(path, options = {}) {
  const res = await fetch(`/api/admin${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      'X-Admin-Token': getAdminToken(),
      ...options.headers,
    },
  });

  if (res.status === 401) {
    const err = new Error('invalid_admin_token');
    err.code = 'INVALID_TOKEN';
    throw err;
  }
  if (res.status === 503) {
    const err = new Error('admin_not_configured');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `request failed (${res.status})`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const adminApi = {
  listGyms: () => adminFetch('/gyms'),
  createGym: (data) => adminFetch('/gyms', { method: 'POST', body: JSON.stringify(data) }),
  updateGym: (id, data) => adminFetch(`/gyms/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteGym: (id) => adminFetch(`/gyms/${id}`, { method: 'DELETE' }),

  createMachine: (gymId, data) =>
    adminFetch(`/gyms/${gymId}/machines`, { method: 'POST', body: JSON.stringify(data) }),
  updateMachine: (id, data) => adminFetch(`/machines/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteMachine: (id) => adminFetch(`/machines/${id}`, { method: 'DELETE' }),
  regenerateMachineKey: (id) => adminFetch(`/machines/${id}/regenerate-key`, { method: 'POST' }),
};
