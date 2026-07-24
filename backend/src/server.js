import express from 'express';
import cors from 'cors';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { listAllMachines } from './store.js';
import { gymsRouter } from './routes/gyms.js';
import { machinesRouter } from './routes/machines.js';
import { devicesRouter } from './routes/devices.js';
import { adminRouter } from './routes/admin.js';
import { registerClient, broadcast } from './hub.js';
import { serializeMachine } from './machines.js';

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/gyms', gymsRouter);
app.use('/api/machines', machinesRouter);
app.use('/api/devices', devicesRouter);
app.use('/api/admin', adminRouter);

app.get('/api/health', (req, res) => res.json({ ok: true }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => registerClient(ws));

// Devices only push on state change, so a device that goes silent (WiFi
// drop, dead battery) never sends the transition to "offline" itself.
// This sweep re-evaluates staleness on a timer and broadcasts the flip so
// connected clients don't have to poll just to catch that case.
const lastBroadcastStatus = new Map();
setInterval(() => {
  for (const machine of listAllMachines()) {
    const serialized = serializeMachine(machine);
    if (lastBroadcastStatus.get(machine.id) !== serialized.status) {
      lastBroadcastStatus.set(machine.id, serialized.status);
      broadcast({ type: 'machine_update', machine: serialized });
    }
  }
}, 15_000);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`gym-tracker backend listening on :${PORT} (HTTP + WS at /ws)`);
});
