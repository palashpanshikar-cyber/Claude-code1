import { Router } from 'express';
import {
  getMachine,
  upsertPushSubscription,
  deletePushSubscriptionByEndpoint,
  addMachineWatch,
  removeMachineWatch,
  listWatchedMachineIds,
} from '../store.js';
import { pushEnabled, pushPublicKey, describeEndpoint } from '../push.js';
import { route } from '../asyncRoute.js';

export const pushRouter = Router();

// The VAPID public key is served rather than baked in at build time, which
// keeps the frontend free of build-time configuration — the same reason it
// uses relative /api paths. It also lets the app tell whether push is
// configured at all and fall back to its WebSocket notifications if not.
pushRouter.get('/config', (req, res) => {
  res.json({ enabled: pushEnabled, publicKey: pushPublicKey() });
});

function readSubscription(body) {
  const endpoint = body?.subscription?.endpoint;
  const p256dh = body?.subscription?.keys?.p256dh;
  const auth = body?.subscription?.keys?.auth;
  if (!endpoint || !p256dh || !auth) return null;
  return { endpoint, p256dh, auth };
}

// Records that this browser wants telling when a machine frees up. The
// browser's subscription is upserted on every call because push services
// rotate endpoints, and a stale row would silently stop delivering.
pushRouter.post('/watch', route(async (req, res) => {
  if (!pushEnabled) return res.status(503).json({ error: 'push_not_configured' });

  const subscription = readSubscription(req.body);
  if (!subscription) return res.status(400).json({ error: 'subscription_required' });

  const machineId = Number(req.body?.machineId);
  if (!Number.isInteger(machineId)) return res.status(400).json({ error: 'machine_id_required' });
  if (!(await getMachine(machineId))) return res.status(404).json({ error: 'machine_not_found' });

  const saved = await upsertPushSubscription(subscription);
  await addMachineWatch(saved.id, machineId);

  // Logged so "the bell did nothing" can be split at its first fork: either
  // the browser never got as far as registering, or it did and the problem
  // is downstream.
  console.log(
    `push: watch registered for machine ${machineId} by ${describeEndpoint(subscription.endpoint)}`,
  );
  res.status(201).json({ ok: true, machineId });
}));

pushRouter.post('/unwatch', route(async (req, res) => {
  if (!pushEnabled) return res.status(503).json({ error: 'push_not_configured' });

  const subscription = readSubscription(req.body);
  if (!subscription) return res.status(400).json({ error: 'subscription_required' });

  const machineId = Number(req.body?.machineId);
  if (!Number.isInteger(machineId)) return res.status(400).json({ error: 'machine_id_required' });

  const saved = await upsertPushSubscription(subscription);
  await removeMachineWatch(saved.id, machineId);

  res.json({ ok: true, machineId });
}));

// Lets the UI restore its bell icons after a reload. Without this, a
// watch set before a refresh is still live on the server but invisible in
// the app, so the bell would read as off while a notification is still
// coming.
pushRouter.post('/watched', route(async (req, res) => {
  if (!pushEnabled) return res.json({ machineIds: [] });

  const endpoint = req.body?.subscription?.endpoint;
  if (!endpoint) return res.status(400).json({ error: 'subscription_required' });

  res.json({ machineIds: await listWatchedMachineIds(endpoint) });
}));

// Called when a browser revokes permission or the user asks to stop
// entirely, so the server isn't left pushing at an endpoint nobody reads.
pushRouter.post('/unsubscribe', route(async (req, res) => {
  const endpoint = req.body?.subscription?.endpoint;
  if (!endpoint) return res.status(400).json({ error: 'subscription_required' });
  await deletePushSubscriptionByEndpoint(endpoint);
  res.status(204).end();
}));
