import express from 'express';
import cors from 'cors';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { listAllMachines, listGyms, initStore, closeStore, storeName } from './store.js';
import { seedDemoData } from './seedData.js';
import { gymsRouter } from './routes/gyms.js';
import { machinesRouter } from './routes/machines.js';
import { devicesRouter } from './routes/devices.js';
import { adminRouter } from './routes/admin.js';
import { registerClient, broadcast } from './hub.js';
import { serializeMachine } from './machines.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// Hosting platforms put a reverse proxy in front of the app, so the
// client's real scheme and IP arrive in X-Forwarded-* headers rather than
// on the socket itself.
app.set('trust proxy', 1);

// Dev runs Vite on :5173 and this API on :3001 — two origins, so the
// browser needs a CORS grant. A deployed build is served from this same
// origin (see the static handler below) and needs none, so production
// defaults to closed. CORS_ORIGIN re-opens it for anyone hosting the two
// halves separately. Devices never send an Origin header, so none of
// this affects firmware either way.
const configuredOrigin = process.env.CORS_ORIGIN;
app.use(
  cors({
    origin: configuredOrigin
      ? configuredOrigin.split(',').map((o) => o.trim())
      : process.env.NODE_ENV !== 'production',
  }),
);

app.use(express.json());

app.use('/api/gyms', gymsRouter);
app.use('/api/machines', machinesRouter);
app.use('/api/devices', devicesRouter);
app.use('/api/admin', adminRouter);

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Everything under /api is reached by fetch(), never by a browser address
// bar, so an unknown endpoint should answer with something a caller can
// parse instead of Express's default HTML error page. Registered after
// every API router so it only catches what none of them matched.
app.use('/api', (req, res) => res.status(404).json({ error: 'not_found' }));

// Serve the built frontend from this same origin when it's present, which
// makes a deployment a single service: one host for the API, the
// WebSocket, and the app. That's also what lets the frontend keep using
// relative /api paths and derive wss:// from window.location without any
// build-time configuration (see frontend/src/lib/api.js).
const clientDir = process.env.CLIENT_DIR || path.join(__dirname, '..', '..', 'frontend', 'dist');
const hasClientBuild = fs.existsSync(path.join(clientDir, 'index.html'));

if (hasClientBuild) {
  app.use(
    express.static(clientDir, {
      // index.html is served by the SPA fallback below, so that one path
      // controls its headers instead of two.
      index: false,
      setHeaders(res, filePath) {
        // Vite fingerprints everything under assets/, so those filenames
        // change whenever their contents do and can be cached hard. The
        // shell and the service worker must not be — a stale copy of
        // either pins clients to an old deploy.
        const cacheable = filePath.includes(`${path.sep}assets${path.sep}`);
        res.setHeader('Cache-Control', cacheable ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    }),
  );

  // /admin and /gyms/:id are client-side routes with no file on disk, so
  // a hard refresh or a shared link has to be answered with the shell.
  // Registered after the API routers so it can't shadow them, and it
  // still declines /api/* so an unknown endpoint 404s as JSON rather
  // than silently returning HTML to a fetch() call.
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api/')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(clientDir, 'index.html'));
  });
}

// Last middleware, so it catches what the async route wrapper forwards.
// Without it Express would answer a failed store call with its default
// HTML error page, which a fetch() caller can't parse.
app.use((err, req, res, next) => {
  console.error('request failed:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'internal_error' });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => registerClient(ws));

// Devices only push on state change, so a device that goes silent (WiFi
// drop, dead battery) never sends the transition to "offline" itself.
// This sweep re-evaluates staleness on a timer and broadcasts the flip so
// connected clients don't have to poll just to catch that case.
const lastBroadcastStatus = new Map();
const offlineSweep = setInterval(async () => {
  try {
    for (const machine of await listAllMachines()) {
      const serialized = serializeMachine(machine);
      if (lastBroadcastStatus.get(machine.id) !== serialized.status) {
        lastBroadcastStatus.set(machine.id, serialized.status);
        broadcast({ type: 'machine_update', machine: serialized });
      }
    }
  } catch (err) {
    // A timer callback that throws takes the process down, and a database
    // blip is not worth restarting the server over — the next tick retries.
    console.error('offline sweep failed (will retry):', err.message);
  }
}, 15_000);

const PORT = process.env.PORT || 3001;

async function start() {
  // Connect and create tables before accepting traffic, so the first
  // request can't land on an unmigrated database.
  await initStore();
  console.log(`store: ${storeName}`);

  // A host with no persistent disk rebuilds the container filesystem on
  // every cold start, so the data file is gone each time the app wakes
  // from idle and it comes back empty with no way in but the admin panel.
  // This puts the demo gyms back so a free-tier deployment is still worth
  // opening. Opt-in, and gated on the store actually being empty, so it
  // can never overwrite data someone entered.
  //
  // Not a substitute for real persistence: the seed mints new device keys
  // each time, so any sensor flashed with the previous ones goes
  // unrecognised. Use DATABASE_URL or a mounted disk before pointing real
  // hardware at a deployment.
  if (process.env.SEED_ON_EMPTY === 'true' && (await listGyms()).length === 0) {
    await seedDemoData();
    console.log('SEED_ON_EMPTY: store was empty — inserted demo gyms');
  }

  // Bind on all interfaces: containers route traffic in from outside the
  // loopback address, so a localhost-only bind is unreachable in a deploy.
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`gym-tracker backend listening on :${PORT} (HTTP + WS at /ws)`);
    console.log(hasClientBuild ? `serving frontend from ${clientDir}` : 'no frontend build found — API only');
    if (!process.env.ADMIN_TOKEN) {
      console.warn('ADMIN_TOKEN not set — admin routes will respond 503 until it is');
    }
  });
}

start().catch((err) => {
  // An unreachable database or a failed migration means the app cannot
  // serve anything meaningful. Exit loudly so the platform reports a
  // failed deploy, rather than staying up and answering every request
  // with a 500.
  console.error('failed to start:', err);
  process.exit(1);
});

// Platforms stop a container by sending SIGTERM and SIGKILLing whatever
// is left after a grace period. Closing deliberately lets in-flight
// requests finish and stops the sweep from starting a data-file write
// during the shutdown window.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received — shutting down`);
  clearInterval(offlineSweep);
  for (const client of wss.clients) client.close(1001, 'server shutting down');
  server.close(async () => {
    // Release database connections rather than leaving the provider to
    // time them out — free tiers cap how many you may hold.
    await closeStore().catch(() => {});
    process.exit(0);
  });
  // Don't hang forever on a connection that refuses to drain. unref() so
  // this timer alone can't be what keeps the process alive.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
