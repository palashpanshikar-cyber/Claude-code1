import { Router } from 'express';
import { getMachineByDeviceId, updateMachineStatus, insertStatusEvent } from '../store.js';
import { serializeMachine } from '../machines.js';
import { broadcast } from '../hub.js';

export const devicesRouter = Router();

const VALID_STATUSES = new Set(['open', 'busy']);

// Devices authenticate with a per-device key (issued at seed/provision time)
// rather than a shared secret, so a single leaked/lost device can be revoked
// without invalidating every other sensor in the fleet.
devicesRouter.post('/:deviceId/status', (req, res) => {
  const { deviceId } = req.params;
  const { status, batteryPct, rssi } = req.body || {};
  const deviceKey = req.get('X-Device-Key');

  if (!VALID_STATUSES.has(status)) {
    return res.status(400).json({ error: 'invalid_status', allowed: [...VALID_STATUSES] });
  }

  const machine = getMachineByDeviceId(deviceId);
  if (!machine) return res.status(404).json({ error: 'unknown_device' });
  if (!deviceKey || deviceKey !== machine.deviceKey) {
    return res.status(401).json({ error: 'invalid_device_key' });
  }

  const now = Date.now();
  const statusChanged = machine.status !== status;

  const updated = updateMachineStatus(machine.id, {
    status,
    batteryPct: batteryPct ?? null,
    rssi: rssi ?? null,
    lastSeenAt: now,
  });

  if (statusChanged) {
    insertStatusEvent(machine.id, status, now);
  }

  const serialized = serializeMachine(updated);
  broadcast({ type: 'machine_update', machine: serialized });

  res.json({ ok: true, machine: serialized });
});
