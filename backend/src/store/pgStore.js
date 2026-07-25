import pg from 'pg';

// Postgres-backed store, used when DATABASE_URL is set. Exists because the
// JSON store keeps its data on the container filesystem, which a host
// without a mounted disk wipes on every deploy and every wake from idle —
// and free tiers don't offer disks. A managed Postgres does have a free
// tier, so this is the way to get data that actually survives without
// paying for hosting.
//
// Timestamps are stored as BIGINT epoch milliseconds rather than
// timestamptz, deliberately: that is the shape the JSON store has always
// produced, and the WebSocket payload, serializeMachine, and the frontend
// adapter all already expect it. Matching it means the two stores are
// interchangeable with no changes above this layer.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS gyms (
  id      SERIAL PRIMARY KEY,
  name    TEXT NOT NULL,
  address TEXT,
  city    TEXT
);

CREATE TABLE IF NOT EXISTS machines (
  id           SERIAL PRIMARY KEY,
  -- ON DELETE CASCADE is what keeps a deleted gym from leaving machines
  -- pointing at a row that no longer exists. The JSON store has to do
  -- this by hand; here the database enforces it.
  gym_id       INTEGER NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  machine_type TEXT,
  zone         TEXT,
  -- Devices authenticate by presenting this id plus its key, so a
  -- duplicate would make authentication ambiguous.
  device_id    TEXT NOT NULL UNIQUE,
  device_key   TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'unknown',
  battery_pct  INTEGER,
  rssi         INTEGER,
  last_seen_at BIGINT
);

CREATE TABLE IF NOT EXISTS status_events (
  id         SERIAL PRIMARY KEY,
  machine_id INTEGER NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  status     TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS machines_gym_id_idx ON machines (gym_id);
CREATE INDEX IF NOT EXISTS machines_device_id_idx ON machines (device_id);
-- listStatusEvents always reads one machine's newest events.
CREATE INDEX IF NOT EXISTS status_events_machine_created_idx
  ON status_events (machine_id, created_at DESC);
`;

// The app speaks camelCase throughout; Postgres columns are snake_case.
// Converting here keeps that difference from leaking past this file.
function toGym(row) {
  if (!row) return undefined;
  return { id: row.id, name: row.name, address: row.address, city: row.city };
}

function toMachine(row) {
  if (!row) return undefined;
  return {
    id: row.id,
    gymId: row.gym_id,
    name: row.name,
    machineType: row.machine_type,
    zone: row.zone,
    deviceId: row.device_id,
    deviceKey: row.device_key,
    status: row.status,
    batteryPct: row.battery_pct,
    rssi: row.rssi,
    // BIGINT arrives from pg as a string, because a 64-bit integer doesn't
    // always fit a JS number. These are epoch milliseconds, well inside
    // the safe range, and everything downstream expects a number.
    lastSeenAt: row.last_seen_at === null ? null : Number(row.last_seen_at),
  };
}

function toEvent(row) {
  return {
    id: row.id,
    machineId: row.machine_id,
    status: row.status,
    createdAt: Number(row.created_at),
  };
}

export function createPgStore(connectionString) {
  const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(connectionString);

  const pool = new pg.Pool({
    connectionString,
    // Managed providers require TLS; a local dev server generally has none.
    // Certificates are verified by default. Providers that present a
    // private CA need DATABASE_SSL_NO_VERIFY=true, which turns verification
    // off — that leaves the connection encrypted but unauthenticated, so
    // set it only when the provider actually requires it.
    ssl: isLocal ? false : { rejectUnauthorized: process.env.DATABASE_SSL_NO_VERIFY !== 'true' },
    // Free Postgres tiers cap connections low, and this app is a single
    // small instance, so a big pool would only risk exhausting the limit.
    max: Number(process.env.DATABASE_POOL_MAX || 5),
    idleTimeoutMillis: 30_000,
  });

  // A pooled client can die between checkouts (a provider idling the
  // connection, a network blip). Without a listener, pg raises that as an
  // unhandled 'error' event and takes the process down.
  pool.on('error', (err) => {
    console.error('postgres pool error (will reconnect):', err.message);
  });

  const query = (text, params) => pool.query(text, params);

  return {
    name: 'postgres',

    async init() {
      await pool.query(SCHEMA);
    },

    async close() {
      await pool.end();
    },

    async resetAll() {
      // TRUNCATE ... CASCADE also resets the SERIAL sequences, so ids
      // restart at 1 exactly as the JSON store's counters do.
      await query('TRUNCATE gyms, machines, status_events RESTART IDENTITY CASCADE');
    },

    async listGyms() {
      const { rows } = await query('SELECT * FROM gyms ORDER BY name');
      return rows.map(toGym);
    },

    async insertGym(name, address, city) {
      const { rows } = await query(
        'INSERT INTO gyms (name, address, city) VALUES ($1, $2, $3) RETURNING *',
        [name, address ?? null, city ?? null],
      );
      return toGym(rows[0]);
    },

    async getGym(id) {
      const { rows } = await query('SELECT * FROM gyms WHERE id = $1', [id]);
      return toGym(rows[0]);
    },

    async updateGym(id, { name, address, city }) {
      // COALESCE on an explicit NULL parameter leaves the column alone, so
      // an omitted field keeps its value while a supplied one overwrites.
      const { rows } = await query(
        `UPDATE gyms SET
           name    = COALESCE($2, name),
           address = COALESCE($3, address),
           city    = COALESCE($4, city)
         WHERE id = $1 RETURNING *`,
        [id, name ?? null, address ?? null, city ?? null],
      );
      return toGym(rows[0]) ?? null;
    },

    async deleteGym(id) {
      const { rowCount } = await query('DELETE FROM gyms WHERE id = $1', [id]);
      return rowCount > 0;
    },

    async listMachinesByGym(gymId) {
      const { rows } = await query('SELECT * FROM machines WHERE gym_id = $1 ORDER BY name', [gymId]);
      return rows.map(toMachine);
    },

    async listAllMachines() {
      const { rows } = await query('SELECT * FROM machines');
      return rows.map(toMachine);
    },

    async getMachine(id) {
      const { rows } = await query('SELECT * FROM machines WHERE id = $1', [id]);
      return toMachine(rows[0]);
    },

    async getMachineByDeviceId(deviceId) {
      const { rows } = await query('SELECT * FROM machines WHERE device_id = $1', [deviceId]);
      return toMachine(rows[0]);
    },

    async insertMachine({ gymId, name, machineType, deviceId, deviceKey, zone }) {
      const { rows } = await query(
        `INSERT INTO machines (gym_id, name, machine_type, zone, device_id, device_key, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'unknown') RETURNING *`,
        [gymId, name, machineType ?? null, zone ?? null, deviceId, deviceKey],
      );
      return toMachine(rows[0]);
    },

    async updateMachineStatus(id, { status, batteryPct, rssi, lastSeenAt }) {
      // Assigned outright rather than COALESCEd: a device that stops
      // reporting battery should read as null, not keep an old figure
      // that would look like a live measurement.
      const { rows } = await query(
        `UPDATE machines
            SET status = $2, battery_pct = $3, rssi = $4, last_seen_at = $5
          WHERE id = $1 RETURNING *`,
        [id, status, batteryPct ?? null, rssi ?? null, lastSeenAt ?? null],
      );
      return toMachine(rows[0]) ?? null;
    },

    async updateMachine(id, { name, machineType, zone }) {
      const { rows } = await query(
        `UPDATE machines SET
           name         = COALESCE($2, name),
           machine_type = COALESCE($3, machine_type),
           zone         = COALESCE($4, zone)
         WHERE id = $1 RETURNING *`,
        [id, name ?? null, machineType ?? null, zone ?? null],
      );
      return toMachine(rows[0]) ?? null;
    },

    async deleteMachine(id) {
      const { rowCount } = await query('DELETE FROM machines WHERE id = $1', [id]);
      return rowCount > 0;
    },

    async regenerateMachineKey(id, newKey) {
      const { rows } = await query(
        'UPDATE machines SET device_key = $2 WHERE id = $1 RETURNING *',
        [id, newKey],
      );
      return toMachine(rows[0]) ?? null;
    },

    async insertStatusEvent(machineId, status, createdAt) {
      const { rows } = await query(
        'INSERT INTO status_events (machine_id, status, created_at) VALUES ($1, $2, $3) RETURNING *',
        [machineId, status, createdAt],
      );
      return toEvent(rows[0]);
    },

    async listStatusEvents(machineId, limit = 50) {
      const { rows } = await query(
        'SELECT * FROM status_events WHERE machine_id = $1 ORDER BY created_at DESC LIMIT $2',
        [machineId, limit],
      );
      return rows.map(toEvent);
    },
  };
}
