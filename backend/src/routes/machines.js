import { Router } from 'express';
import { getMachine, listStatusEvents, setCrowdReport } from '../store.js';
import { serializeMachine } from '../machines.js';
import { broadcast } from '../hub.js';
import { route } from '../asyncRoute.js';

export const machinesRouter = Router();

const REPORTABLE_STATUSES = new Set(['open', 'busy']);

// One report per machine per client per this long. There are no accounts,
// so this cannot stop a determined abuser — it stops a double-tapped
// button and casual noise, which is what actually happens. Held in memory
// rather than the database because it is worth nothing after a restart
// and the app runs as a single instance anyway.
const REPORT_COOLDOWN_MS = 30_000;
const lastReportAt = new Map();

// Bounded so a stream of distinct client addresses can't grow this map
// without limit. Entries older than the cooldown carry no meaning.
function pruneCooldowns(now) {
  for (const [key, at] of lastReportAt) {
    if (now - at > REPORT_COOLDOWN_MS) lastReportAt.delete(key);
  }
}

machinesRouter.get('/:machineId', route(async (req, res) => {
  const machineId = Number(req.params.machineId);
  const machine = await getMachine(machineId);
  if (!machine) return res.status(404).json({ error: 'not_found' });

  const history = await listStatusEvents(machineId, 50);
  res.json({ ...serializeMachine(machine), history });
}));

// Lets anyone using the gym say whether a machine is free, for the case
// this app otherwise has no answer to: a machine with no sensor on it.
// Deliberately unauthenticated, like the rest of the read-side app — the
// alternative is accounts, and a wrong "busy" costs someone a short walk.
// A live sensor always overrides this (see serializeMachine), and the
// report expires on its own.
machinesRouter.post('/:machineId/report', route(async (req, res) => {
  const machineId = Number(req.params.machineId);
  const { status } = req.body || {};

  if (!REPORTABLE_STATUSES.has(status)) {
    return res.status(400).json({ error: 'invalid_status', allowed: [...REPORTABLE_STATUSES] });
  }

  const machine = await getMachine(machineId);
  if (!machine) return res.status(404).json({ error: 'not_found' });

  const now = Date.now();
  pruneCooldowns(now);
  // req.ip reflects X-Forwarded-For because server.js trusts the proxy.
  // Behind NAT a whole gym shares one address, which is a deliberate
  // trade: throttling a shared address is better than throttling nothing.
  const cooldownKey = `${req.ip}:${machineId}`;
  const previous = lastReportAt.get(cooldownKey);
  if (previous && now - previous < REPORT_COOLDOWN_MS) {
    return res.status(429).json({
      error: 'too_soon',
      retryAfterMs: REPORT_COOLDOWN_MS - (now - previous),
    });
  }
  lastReportAt.set(cooldownKey, now);

  const updated = await setCrowdReport(machineId, status, now);
  if (!updated) return res.status(404).json({ error: 'not_found' });

  const serialized = serializeMachine(updated);
  // Same broadcast shape a device report produces, so every open client
  // updates through the existing WebSocket path with no new plumbing.
  broadcast({ type: 'machine_update', machine: serialized });

  res.json({ ok: true, machine: serialized });
}));
