// A machine is considered offline if we haven't heard from its device
// within this window, regardless of the last status it reported — an
// ESP32/ESP8266 that loses WiFi mid-"busy" should not show as busy forever.
export const OFFLINE_AFTER_MS = 90_000;

export function serializeMachine(machine) {
  const isStale = machine.lastSeenAt == null || Date.now() - machine.lastSeenAt > OFFLINE_AFTER_MS;
  return {
    id: machine.id,
    gymId: machine.gymId,
    name: machine.name,
    machineType: machine.machineType,
    zone: machine.zone ?? null,
    status: isStale ? 'offline' : machine.status,
    batteryPct: machine.batteryPct,
    rssi: machine.rssi,
    lastSeenAt: machine.lastSeenAt,
  };
}
