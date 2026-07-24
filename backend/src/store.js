import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Plain JSON-file store instead of a real database. better-sqlite3 (and
// most other Node SQLite bindings) need a native addon compiled via
// node-gyp at install time, which requires Python + a C++ toolchain —
// friction many machines (especially fresh Windows installs) don't have
// out of the box. This prototype's data volume is tiny, so a JSON file is
// plenty; swap to a real DB before a multi-gym production deployment with
// concurrent writers.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = process.env.DATA_PATH || path.join(__dirname, '..', 'data.json');

function empty() {
  return { gyms: [], machines: [], statusEvents: [], nextGymId: 1, nextMachineId: 1, nextEventId: 1 };
}

let data = fs.existsSync(DATA_PATH) ? JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')) : empty();

function persist() {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}

export function resetAll() {
  data = empty();
  persist();
}

export function listGyms() {
  return [...data.gyms].sort((a, b) => a.name.localeCompare(b.name));
}

export function insertGym(name, address, city) {
  const gym = { id: data.nextGymId++, name, address, city: city ?? null };
  data.gyms.push(gym);
  persist();
  return gym;
}

export function getGym(id) {
  return data.gyms.find((g) => g.id === id);
}

export function updateGym(id, { name, address, city }) {
  const gym = getGym(id);
  if (!gym) return null;
  if (name !== undefined) gym.name = name;
  if (address !== undefined) gym.address = address;
  if (city !== undefined) gym.city = city;
  persist();
  return gym;
}

// Deleting a gym also removes its machines (and their status history) —
// leaving orphaned machines pointing at a gym_id that no longer exists
// would silently break every machine-listing query for that gym.
export function deleteGym(id) {
  const gym = getGym(id);
  if (!gym) return false;
  const machineIds = data.machines.filter((m) => m.gymId === id).map((m) => m.id);
  data.machines = data.machines.filter((m) => m.gymId !== id);
  data.statusEvents = data.statusEvents.filter((e) => !machineIds.includes(e.machineId));
  data.gyms = data.gyms.filter((g) => g.id !== id);
  persist();
  return true;
}

export function listMachinesByGym(gymId) {
  return data.machines.filter((m) => m.gymId === gymId).sort((a, b) => a.name.localeCompare(b.name));
}

export function listAllMachines() {
  return [...data.machines];
}

export function getMachine(id) {
  return data.machines.find((m) => m.id === id);
}

export function getMachineByDeviceId(deviceId) {
  return data.machines.find((m) => m.deviceId === deviceId);
}

export function insertMachine({ gymId, name, machineType, deviceId, deviceKey, zone }) {
  const machine = {
    id: data.nextMachineId++,
    gymId,
    name,
    machineType,
    zone: zone ?? null,
    deviceId,
    deviceKey,
    status: 'unknown',
    batteryPct: null,
    rssi: null,
    lastSeenAt: null,
  };
  data.machines.push(machine);
  persist();
  return machine;
}

export function updateMachineStatus(id, { status, batteryPct, rssi, lastSeenAt }) {
  const machine = getMachine(id);
  machine.status = status;
  machine.batteryPct = batteryPct;
  machine.rssi = rssi;
  machine.lastSeenAt = lastSeenAt;
  persist();
  return machine;
}

// Metadata-only edit (name/type/zone) — deliberately excludes status,
// deviceId, deviceKey: those are device-owned or security-sensitive and
// have their own dedicated update paths (updateMachineStatus,
// regenerateMachineKey), not the general admin edit form.
export function updateMachine(id, { name, machineType, zone }) {
  const machine = getMachine(id);
  if (!machine) return null;
  if (name !== undefined) machine.name = name;
  if (machineType !== undefined) machine.machineType = machineType;
  if (zone !== undefined) machine.zone = zone;
  persist();
  return machine;
}

export function deleteMachine(id) {
  const machine = getMachine(id);
  if (!machine) return false;
  data.machines = data.machines.filter((m) => m.id !== id);
  data.statusEvents = data.statusEvents.filter((e) => e.machineId !== id);
  persist();
  return true;
}

// Issues a fresh device_key and invalidates the old one — used when a key
// needs to be re-shown (e.g. lost before flashing) instead of ever storing
// or re-serving the original key in plaintext after creation time.
export function regenerateMachineKey(id, newKey) {
  const machine = getMachine(id);
  if (!machine) return null;
  machine.deviceKey = newKey;
  persist();
  return machine;
}

export function insertStatusEvent(machineId, status, createdAt) {
  const event = { id: data.nextEventId++, machineId, status, createdAt };
  data.statusEvents.push(event);
  persist();
  return event;
}

export function listStatusEvents(machineId, limit = 50) {
  return data.statusEvents
    .filter((e) => e.machineId === machineId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}
