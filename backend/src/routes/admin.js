import { Router } from 'express';
import crypto from 'node:crypto';
import {
  listGyms, insertGym, getGym, updateGym, deleteGym,
  insertMachine, updateMachine, deleteMachine, regenerateMachineKey,
} from '../store.js';
import { serializeMachine } from '../machines.js';
import { requireAdmin } from '../adminAuth.js';
import { withMachineCounts } from './gyms.js';
import { route } from '../asyncRoute.js';

export const adminRouter = Router();

adminRouter.use(requireAdmin);

adminRouter.get('/gyms', route(async (req, res) => {
  const gyms = await listGyms();
  res.json(await Promise.all(gyms.map(withMachineCounts)));
}));

adminRouter.post('/gyms', route(async (req, res) => {
  const { name, address, city } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name_required' });
  res.status(201).json(await insertGym(name, address ?? null, city ?? null));
}));

adminRouter.patch('/gyms/:gymId', route(async (req, res) => {
  const gym = await updateGym(Number(req.params.gymId), req.body || {});
  if (!gym) return res.status(404).json({ error: 'not_found' });
  res.json(gym);
}));

adminRouter.delete('/gyms/:gymId', route(async (req, res) => {
  const ok = await deleteGym(Number(req.params.gymId));
  if (!ok) return res.status(404).json({ error: 'not_found' });
  res.status(204).end();
}));

adminRouter.post('/gyms/:gymId/machines', route(async (req, res) => {
  const gymId = Number(req.params.gymId);
  if (!(await getGym(gymId))) return res.status(404).json({ error: 'gym_not_found' });

  const { name, machineType, zone } = req.body || {};
  if (!name || !machineType) return res.status(400).json({ error: 'name_and_machine_type_required' });

  const deviceId = `dev_${crypto.randomBytes(4).toString('hex')}`;
  const deviceKey = crypto.randomBytes(16).toString('hex');
  const machine = await insertMachine({ gymId, name, machineType, zone: zone ?? null, deviceId, deviceKey });

  // Only response that ever includes the plaintext deviceKey — like a
  // GitHub personal access token, it's shown once at creation time and
  // never re-servable afterwards (see regenerate-key for the recovery path).
  res.status(201).json({ ...serializeMachine(machine), deviceId, deviceKey });
}));

adminRouter.patch('/machines/:machineId', route(async (req, res) => {
  const machine = await updateMachine(Number(req.params.machineId), req.body || {});
  if (!machine) return res.status(404).json({ error: 'not_found' });
  res.json(serializeMachine(machine));
}));

adminRouter.delete('/machines/:machineId', route(async (req, res) => {
  const ok = await deleteMachine(Number(req.params.machineId));
  if (!ok) return res.status(404).json({ error: 'not_found' });
  res.status(204).end();
}));

adminRouter.post('/machines/:machineId/regenerate-key', route(async (req, res) => {
  const newKey = crypto.randomBytes(16).toString('hex');
  const machine = await regenerateMachineKey(Number(req.params.machineId), newKey);
  if (!machine) return res.status(404).json({ error: 'not_found' });
  res.json({ ...serializeMachine(machine), deviceId: machine.deviceId, deviceKey: newKey });
}));
