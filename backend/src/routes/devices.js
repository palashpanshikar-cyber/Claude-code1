import { Router } from 'express';
import { getMachineByDeviceId, updateMachineStatus, insertStatusEvent } from '../store.js';
import { serializeMachine } from '../machines.js';
import { publishMachineUpdate } from '../machineEvents.js';
import { route } from '../asyncRoute.js';

export const devicesRouter = Router();

const VALID_STATUSES = new Set(['open', 'busy']);

// Devices authenticate with a per-device key (issued at seed/provision time)
// rather than a shared secret, so a single leaked/lost device can be revoked
// without invalidating every other sensor in the fleet.
devicesRouter.post('/:deviceId/status', route(async (req, res) => {
  const { deviceId } = req.params;
  const { status, batteryPct, rssi } = req.body || {};
  const deviceKey = req.get('X-Device-Key');

  if (!VALID_STATUSES.has(status)) {
    return res.status(400).json({ error: 'invalid_status', allowed: [...VALID_STATUSES] });
  }

  const machine = await getMachineByDeviceId(deviceId);
  if (!machine) return res.status(404).json({ error: 'unknown_device' });
  if (!deviceKey || deviceKey !== machine.deviceKey) {
    return res.status(401).json({ error: 'invalid_device_key' });
  }

  const now = Date.now();
  // Compared on the effective status, not the raw column: a machine whose
  // sensor had gone stale reads as offline, so the same status coming back
  // is a real transition that someone waiting deserves to hear about.
  const previousStatus = serializeMachine(machine).status;
  const statusChanged = machine.status !== status;

  const updated = await updateMachineStatus(machine.id, {
    status,
    batteryPct: batteryPct ?? null,
    rssi: rssi ?? null,
    lastSeenAt: now,
  });
  // The machine was read a moment ago but could have been deleted in
  // between — a longer window now that each store call is a round trip.
  if (!updated) return res.status(404).json({ error: 'unknown_device' });

  if (statusChanged) {
    await insertStatusEvent(machine.id, status, now);
  }

  const serialized = serializeMachine(updated);
  await publishMachineUpdate(serialized, {
    statusChanged: serialized.status !== previousStatus,
  });

  res.json({ ok: true, machine: serialized });
}));
