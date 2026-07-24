import crypto from 'node:crypto';
import { resetAll, insertGym, insertMachine } from './store.js';

// Wipes and re-seeds demo data: two gyms, a handful of machines each.
// Run with: npm run seed
resetAll();

const ZONE_BY_TYPE = {
  rack: 'Free Weights',
  bench: 'Free Weights',
  cable: 'Strength Zone',
  plate: 'Strength Zone',
  cardio: 'Cardio Zone',
};

const gyms = [
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

for (const gym of gyms) {
  const gymRow = insertGym(gym.name, gym.address, gym.city);
  for (const [name, type] of gym.machines) {
    const deviceId = `dev_${crypto.randomBytes(4).toString('hex')}`;
    const deviceKey = crypto.randomBytes(16).toString('hex');
    insertMachine({
      gymId: gymRow.id,
      name,
      machineType: type,
      zone: ZONE_BY_TYPE[type] ?? null,
      deviceId,
      deviceKey,
    });
    console.log(`${gym.name} / ${name}: device_id=${deviceId} device_key=${deviceKey}`);
  }
}

console.log('\nSeeded. Use the device_id/device_key pairs above to configure each ESP32/ESP8266 (see firmware/).');
