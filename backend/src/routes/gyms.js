import { Router } from 'express';
import { listGyms, getGym, listMachinesByGym } from '../store.js';
import { serializeMachine } from '../machines.js';
import { route } from '../asyncRoute.js';

export const gymsRouter = Router();

// Cached counts (open_machines/total_machines) aren't stored on the gym
// record itself — they're derived here from the live machine list so they
// can never drift out of sync with the machines' actual statuses.
export async function withMachineCounts(gym) {
  const machines = (await listMachinesByGym(gym.id)).map(serializeMachine);
  return {
    ...gym,
    totalMachines: machines.length,
    openMachines: machines.filter((m) => m.status === 'open').length,
  };
}

gymsRouter.get('/', route(async (req, res) => {
  const gyms = await listGyms();
  // Run the per-gym counts together rather than in sequence: against a
  // database each one is a network round trip, and awaiting them one at a
  // time would make this page's latency scale with the number of gyms.
  res.json(await Promise.all(gyms.map(withMachineCounts)));
}));

gymsRouter.get('/:gymId', route(async (req, res) => {
  const gymId = Number(req.params.gymId);
  const gym = await getGym(gymId);
  if (!gym) return res.status(404).json({ error: 'not_found' });
  res.json(await withMachineCounts(gym));
}));

gymsRouter.get('/:gymId/machines', route(async (req, res) => {
  const gymId = Number(req.params.gymId);
  res.json((await listMachinesByGym(gymId)).map(serializeMachine));
}));
