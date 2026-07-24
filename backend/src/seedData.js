import crypto from 'node:crypto';
import { insertGym, insertMachine } from './store.js';

// The demo dataset, shared by the `npm run seed` CLI and the optional
// boot-time seed in server.js. Kept separate from seed.js because that
// file wipes the store as a side effect of being imported, which is fine
// for a command you ran on purpose and very much not fine for a server.

const ZONE_BY_TYPE = {
  rack: 'Free Weights',
  bench: 'Free Weights',
  cable: 'Strength Zone',
  plate: 'Strength Zone',
  cardio: 'Cardio Zone',
};

const DEMO_GYMS = [
  { name: 'Downtown Fitness', address: '123 Main St', city: 'Springfield', machines: [
    ['Squat Rack 1', 'rack'], ['Squat Rack 2', 'rack'],
    ['Bench Press 1', 'bench'], ['Lat Pulldown', 'cable'],
    ['Leg Press', 'plate'], ['Treadmill 1', 'cardio'],
  ] },
  { name: 'Uptown Gym', address: '456 Oak Ave', city: 'Springfield', machines: [
    ['Squat Rack 1', 'rack'], ['Cable Crossover', 'cable'],
    ['Leg Extension', 'plate'], ['Rowing Machine', 'cardio'],
  ] },
];

// Inserts the demo gyms and machines. Deliberately does not clear what's
// already there — the two callers want opposite things. The CLI wipes
// first, on purpose; the boot-time seed only ever runs against a store
// it has already checked is empty.
//
// Device keys are freshly generated on every call, so a machine seeded
// twice is not the same machine twice: anything already flashed with the
// previous key stops being recognised.
export function seedDemoData({ onMachine } = {}) {
  for (const gym of DEMO_GYMS) {
    const gymRow = insertGym(gym.name, gym.address, gym.city);
    for (const [name, machineType] of gym.machines) {
      const deviceId = `dev_${crypto.randomBytes(4).toString('hex')}`;
      const deviceKey = crypto.randomBytes(16).toString('hex');
      insertMachine({
        gymId: gymRow.id,
        name,
        machineType,
        zone: ZONE_BY_TYPE[machineType] ?? null,
        deviceId,
        deviceKey,
      });
      onMachine?.({ gymName: gym.name, name, deviceId, deviceKey });
    }
  }
}
