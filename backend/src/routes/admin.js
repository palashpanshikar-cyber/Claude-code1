import { Router } from 'express';
import crypto from 'node:crypto';
import {
  listGyms, insertGym, getGym, updateGym, deleteGym,
  insertMachine, updateMachine, deleteMachine, regenerateMachineKey,
} from '../store.js';
import { serializeMachine } from '../machines.js';
import { requireAdmin } from '../adminAuth.js';
import { withMachineCounts } from './gyms.js';

export const adminRouter = Router();

adminRouter.use(requireAdmin);

adminRouter.get('/gyms', (req, res) => {
  res.json(listGyms().map(withMachineCounts));
});

adminRouter.post('/gyms', (req, res) => {
  const { name, address, city } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name_required' });
  res.status(201).json(insertGym(name, address ?? null, city ?? null));
});

adminRouter.patch('/gyms/:gymId', (req, res) => {
  const gym = updateGym(Number(req.params.gymId), req.body || {});
  if (!gym) return res.status(404).json({ error: 'not_found' });
  res.json(gym);
});

adminRouter.delete('/gyms/:gymId', (req, res) => {
  const ok = deleteGym(Number(req.params.gymId));
  if (!ok) return res.status(404).json({ error: 'not_found' });
  res.status(204).end();
});

adminRouter.post('/gyms/:gymId/machines', (req, res) => {
  const gymId = Number(req.params.gymId);
  if (!getGym(gymId)) return res.status(404).json({ error: 'gym_not_found' });

  const { name, machineType, zone } = req.body || {};
  if (!name || !machineType) return res.status(400).json({ error: 'name_and_machine_type_required' });

  const deviceId = `dev_${crypto.randomBytes(4).toString('hex')}`;
  const deviceKey = crypto.randomBytes(16).toString('hex');
  const machine = insertMachine({ gymId, name, machineType, zone: zone ?? null, deviceId, deviceKey });

  // Only response that ever includes the plaintext deviceKey — like a
  // GitHub personal access token, it's shown once at creation time and
  // never re-servable afterwards (see regenerate-key for the recovery path).
  res.status(201).json({ ...serializeMachine(machine), deviceId, deviceKey });
});

adminRouter.patch('/machines/:machineId', (req, res) => {
  const machine = updateMachine(Number(req.params.machineId), req.body || {});
  if (!machine) return res.status(404).json({ error: 'not_found' });
  res.json(serializeMachine(machine));
});

adminRouter.delete('/machines/:machineId', (req, res) => {
  const ok = deleteMachine(Number(req.params.machineId));
  if (!ok) return res.status(404).json({ error: 'not_found' });
  res.status(204).end();
});

adminRouter.post('/machines/:machineId/regenerate-key', (req, res) => {
  const newKey = crypto.randomBytes(16).toString('hex');
  const machine = regenerateMachineKey(Number(req.params.machineId), newKey);
  if (!machine) return res.status(404).json({ error: 'not_found' });
  res.json({ ...serializeMachine(machine), deviceId: machine.deviceId, deviceKey: newKey });
});
