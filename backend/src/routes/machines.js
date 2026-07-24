import { Router } from 'express';
import { getMachine, listStatusEvents } from '../store.js';
import { serializeMachine } from '../machines.js';

export const machinesRouter = Router();

machinesRouter.get('/:machineId', (req, res) => {
  const machineId = Number(req.params.machineId);
  const machine = getMachine(machineId);
  if (!machine) return res.status(404).json({ error: 'not_found' });

  const history = listStatusEvents(machineId, 50);
  res.json({ ...serializeMachine(machine), history });
});
