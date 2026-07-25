import { createJsonStore } from './store/jsonStore.js';
import { createPgStore } from './store/pgStore.js';

// Chooses a storage backend and re-exports its operations, so nothing else
// in the app knows or cares which one is in use.
//
// Set DATABASE_URL and data lives in Postgres, which is how a deployment
// keeps its gyms across restarts without paying for a persistent disk.
// Leave it unset and data lives in a JSON file, which is what makes
// `npm install && npm start` work with no database to provision.
//
// Every operation is async, including the JSON one where nothing actually
// awaits, so the two are drop-in interchangeable.

const store = process.env.DATABASE_URL
  ? createPgStore(process.env.DATABASE_URL)
  : createJsonStore();

export const storeName = store.name;

export const {
  init: initStore,
  close: closeStore,
  resetAll,
  listGyms,
  insertGym,
  getGym,
  updateGym,
  deleteGym,
  listMachinesByGym,
  listAllMachines,
  getMachine,
  getMachineByDeviceId,
  insertMachine,
  updateMachineStatus,
  updateMachine,
  deleteMachine,
  regenerateMachineKey,
  insertStatusEvent,
  listStatusEvents,
} = store;
