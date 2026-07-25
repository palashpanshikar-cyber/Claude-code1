import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Plain JSON-file store. Originally the only store: better-sqlite3 needs a
// native addon compiled via node-gyp at install time, which requires
// Python and a C++ toolchain that a fresh Windows machine doesn't have.
// Still the default, because it makes `npm install && npm start` work with
// no database to set up.
//
// Its limits are real, though, and they're why pgStore.js exists: the file
// lives on the container filesystem, which a host without a mounted disk
// erases on every deploy, and every write rewrites the whole file, so it
// assumes exactly one process is writing.
//
// Every function is async purely to match pgStore's interface. Nothing
// here actually awaits.

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function emptyData() {
  return { gyms: [], machines: [], statusEvents: [], nextGymId: 1, nextMachineId: 1, nextEventId: 1 };
}

export function createJsonStore() {
  const dataPath = process.env.DATA_PATH || path.join(__dirname, '..', '..', 'data.json');

  // DATA_PATH usually points into a mounted volume, which may exist
  // without the file, or not exist at all on a first boot.
  fs.mkdirSync(path.dirname(dataPath), { recursive: true });

  let data = fs.existsSync(dataPath) ? JSON.parse(fs.readFileSync(dataPath, 'utf8')) : emptyData();

  function persist() {
    // Every device report rewrites this entire file, so an unattended
    // deployment does it constantly. Writing in place means a crash or a
    // redeploy mid-write leaves a truncated file that fails to parse on
    // the next boot, losing every gym. Write to a temp file and rename:
    // rename(2) is atomic within a filesystem, so a reader sees either
    // the old file or the new one, never a half-written one.
    const tmpPath = `${dataPath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
    fs.renameSync(tmpPath, dataPath);
  }

  const getMachineSync = (id) => data.machines.find((m) => m.id === id);

  return {
    name: `json (${dataPath})`,

    async init() {
      // Nothing to connect to; the file was read above.
    },

    async close() {},

    async resetAll() {
      data = emptyData();
      persist();
    },

    async listGyms() {
      return [...data.gyms].sort((a, b) => a.name.localeCompare(b.name));
    },

    async insertGym(name, address, city) {
      const gym = { id: data.nextGymId++, name, address, city: city ?? null };
      data.gyms.push(gym);
      persist();
      return gym;
    },

    async getGym(id) {
      return data.gyms.find((g) => g.id === id);
    },

    async updateGym(id, { name, address, city }) {
      const gym = data.gyms.find((g) => g.id === id);
      if (!gym) return null;
      if (name !== undefined) gym.name = name;
      if (address !== undefined) gym.address = address;
      if (city !== undefined) gym.city = city;
      persist();
      return gym;
    },

    // Deleting a gym also removes its machines and their status history.
    // Orphaned machines pointing at a gym that no longer exists would
    // silently break every machine listing for that gym. pgStore gets
    // this from ON DELETE CASCADE instead.
    async deleteGym(id) {
      const gym = data.gyms.find((g) => g.id === id);
      if (!gym) return false;
      const machineIds = new Set(data.machines.filter((m) => m.gymId === id).map((m) => m.id));
      data.gyms = data.gyms.filter((g) => g.id !== id);
      data.machines = data.machines.filter((m) => m.gymId !== id);
      data.statusEvents = data.statusEvents.filter((e) => !machineIds.has(e.machineId));
      persist();
      return true;
    },

    async listMachinesByGym(gymId) {
      return data.machines
        .filter((m) => m.gymId === gymId)
        .sort((a, b) => a.name.localeCompare(b.name));
    },

    async listAllMachines() {
      return [...data.machines];
    },

    async getMachine(id) {
      return getMachineSync(id);
    },

    async getMachineByDeviceId(deviceId) {
      return data.machines.find((m) => m.deviceId === deviceId);
    },

    async insertMachine({ gymId, name, machineType, deviceId, deviceKey, zone }) {
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
        crowdStatus: null,
        crowdReportedAt: null,
      };
      data.machines.push(machine);
      persist();
      return machine;
    },

    async setCrowdReport(id, status, reportedAt) {
      const machine = getMachineSync(id);
      if (!machine) return null;
      // Stored separately from the device's own status rather than
      // overwriting it, so a sensor coming back online immediately takes
      // precedence again without having to undo anything.
      machine.crowdStatus = status;
      machine.crowdReportedAt = reportedAt;
      persist();
      return machine;
    },

    async updateMachineStatus(id, { status, batteryPct, rssi, lastSeenAt }) {
      const machine = getMachineSync(id);
      if (!machine) return null;
      machine.status = status;
      machine.batteryPct = batteryPct;
      machine.rssi = rssi;
      machine.lastSeenAt = lastSeenAt;
      persist();
      return machine;
    },

    // Metadata-only edit (name/type/zone) — deliberately excludes status,
    // deviceId and deviceKey. Those are device-owned or security-sensitive
    // and have their own paths (updateMachineStatus, regenerateMachineKey),
    // not the general admin edit form.
    async updateMachine(id, { name, machineType, zone }) {
      const machine = getMachineSync(id);
      if (!machine) return null;
      if (name !== undefined) machine.name = name;
      if (machineType !== undefined) machine.machineType = machineType;
      if (zone !== undefined) machine.zone = zone;
      persist();
      return machine;
    },

    async deleteMachine(id) {
      const machine = getMachineSync(id);
      if (!machine) return false;
      data.machines = data.machines.filter((m) => m.id !== id);
      data.statusEvents = data.statusEvents.filter((e) => e.machineId !== id);
      persist();
      return true;
    },

    // Issues a fresh device_key and invalidates the old one, for when a key
    // is lost before flashing. The original is never stored in a re-servable
    // form after creation.
    async regenerateMachineKey(id, newKey) {
      const machine = getMachineSync(id);
      if (!machine) return null;
      machine.deviceKey = newKey;
      persist();
      return machine;
    },

    async insertStatusEvent(machineId, status, createdAt) {
      const event = { id: data.nextEventId++, machineId, status, createdAt };
      data.statusEvents.push(event);
      persist();
      return event;
    },

    async listStatusEvents(machineId, limit = 50) {
      return data.statusEvents
        .filter((e) => e.machineId === machineId)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit);
    },
  };
}
