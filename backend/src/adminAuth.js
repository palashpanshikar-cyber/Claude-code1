// Gates the admin CRUD routes behind a single shared token, set via the
// ADMIN_TOKEN env var. Deliberately no hardcoded default — an admin panel
// that can delete gyms/machines must never be reachable with a token
// nobody explicitly chose. If ADMIN_TOKEN isn't set, every admin route
// responds 503 rather than silently running open or silently refusing
// with a confusing 401.
export function requireAdmin(req, res, next) {
  const configuredToken = process.env.ADMIN_TOKEN;
  if (!configuredToken) {
    return res.status(503).json({
      error: 'admin_not_configured',
      message: 'Set the ADMIN_TOKEN environment variable before starting the backend to enable admin routes.',
    });
  }

  const providedToken = req.get('X-Admin-Token');
  if (!providedToken || providedToken !== configuredToken) {
    return res.status(401).json({ error: 'invalid_admin_token' });
  }

  next();
}
