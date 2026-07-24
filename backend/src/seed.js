import { resetAll } from './store.js';
import { seedDemoData } from './seedData.js';

// Wipes and re-seeds demo data: two gyms, a handful of machines each.
// Run with: npm run seed
//
// The dataset itself lives in seedData.js so the server can reuse it for
// the optional SEED_ON_EMPTY boot seed without also inheriting the wipe
// below.
resetAll();

seedDemoData({
  onMachine: ({ gymName, name, deviceId, deviceKey }) => {
    console.log(`${gymName} / ${name}: device_id=${deviceId} device_key=${deviceKey}`);
  },
});

console.log('\nSeeded. Use the device_id/device_key pairs above to configure each ESP32/ESP8266 (see firmware/).');
