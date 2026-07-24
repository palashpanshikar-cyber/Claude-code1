// Talks to this repo's own Node backend (see ../../../backend) instead of
// Base44's hosted backend that this UI originally shipped with. Field names
// and status vocabulary differ between the two, so every response is mapped
// here — components only ever see the shape below, never the raw backend
// response.

function mapGym(g) {
  return {
    id: g.id,
    name: g.name,
    address: g.address,
    city: g.city ?? null,
    image_url: g.imageUrl ?? null,
    total_machines: g.totalMachines ?? 0,
    open_machines: g.openMachines ?? 0,
  };
}

function mapMachine(m) {
  return {
    id: m.id,
    gym_id: m.gymId,
    name: m.name,
    machine_type: m.machineType,
    zone: m.zone ?? null,
    status: m.status, // backend already uses open/busy/offline/unknown
    battery_pct: m.batteryPct ?? null,
    last_updated: m.lastSeenAt ? new Date(m.lastSeenAt).toISOString() : null,
  };
}

export async function fetchGyms() {
  const res = await fetch('/api/gyms');
  if (!res.ok) throw new Error('failed to load gyms');
  const data = await res.json();
  return data.map(mapGym);
}

export async function fetchGym(gymId) {
  const res = await fetch(`/api/gyms/${gymId}`);
  if (!res.ok) throw new Error('failed to load gym');
  return mapGym(await res.json());
}

export async function fetchMachines(gymId) {
  const res = await fetch(`/api/gyms/${gymId}/machines`);
  if (!res.ok) throw new Error('failed to load machines');
  const data = await res.json();
  return data.map(mapMachine);
}

// Live status updates over WebSocket, with a poll fallback (the caller is
// expected to also re-fetch periodically) so the UI stays correct even if
// the socket drops and reconnection is delayed.
export function subscribeToUpdates(onMachineUpdate) {
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const wsUrl = `${protocol}://${window.location.host}/ws`;
  let socket;
  let closedByCaller = false;
  let reconnectTimer;

  function connect() {
    socket = new WebSocket(wsUrl);
    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'machine_update') onMachineUpdate(mapMachine(data.machine));
      } catch {
        // ignore malformed frames
      }
    };
    socket.onclose = () => {
      if (!closedByCaller) reconnectTimer = setTimeout(connect, 2000);
    };
  }

  connect();

  return () => {
    closedByCaller = true;
    clearTimeout(reconnectTimer);
    socket?.close();
  };
}
