import { Router } from 'express';
import { listGyms, getGym, listMachinesByGym } from '../store.js';
import { serializeMachine } from '../machines.js';

export const gymsRouter = Router();

// Cached counts (open_machines/total_machines) aren't stored on the gym
// record itself — they're derived here from the live machine list so they
// can never drift out of sync with the machines' actual statuses.
export function withMachineCounts(gym) {
  const machines = listMachinesByGym(gym.id).map(serializeMachine);
  return {
    ...gym,
    totalMachines: machines.length,
    openMachines: machines.filter((m) => m.status === 'open').length,
  };
}

gymsRouter.get('/', (req, res) => {
  res.json(listGyms().map(withMachineCounts));
});

gymsRouter.get('/:gymId', (req, res) => {
  const gymId = Number(req.params.gymId);
  const gym = getGym(gymId);
  if (!gym) return res.status(404).json({ error: 'not_found' });
  res.json(withMachineCounts(gym));
});

gymsRouter.get('/:gymId/machines', (req, res) => {
  const gymId = Number(req.params.gymId);
  res.json(listMachinesByGym(gymId).map(serializeMachine));
});
