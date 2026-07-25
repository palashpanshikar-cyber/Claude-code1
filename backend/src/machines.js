// A machine is considered offline if we haven't heard from its device
// within this window, regardless of the last status it reported — an
// ESP32/ESP8266 that loses WiFi mid-"busy" should not show as busy forever.
export const OFFLINE_AFTER_MS = 90_000;

// How long a person's report is worth showing. Someone saying a rack was
// busy half an hour ago tells you nothing useful, and showing it as
// current would be worse than showing nothing — the whole value of this
// app is that what it says is true right now. Roughly one long set plus
// the walk over to check.
export const CROWD_REPORT_VALID_MS = 20 * 60_000;

export function serializeMachine(machine) {
  const sensorLive =
    machine.lastSeenAt != null && Date.now() - machine.lastSeenAt <= OFFLINE_AFTER_MS;
  const crowdFresh =
    machine.crowdReportedAt != null &&
    Date.now() - machine.crowdReportedAt <= CROWD_REPORT_VALID_MS;

  // A live sensor always wins. It samples continuously and has no opinion,
  // where a person reports once, from memory, and may be guessing or
  // trolling. A crowd report only fills the gap where there is no working
  // sensor at all — which is every machine until the hardware exists.
  let status = 'offline';
  let statusSource = null;
  if (sensorLive) {
    status = machine.status;
    statusSource = 'sensor';
  } else if (crowdFresh) {
    status = machine.crowdStatus;
    statusSource = 'crowd';
  }

  return {
    id: machine.id,
    gymId: machine.gymId,
    name: machine.name,
    machineType: machine.machineType,
    zone: machine.zone ?? null,
    status,
    statusSource,
    batteryPct: machine.batteryPct,
    rssi: machine.rssi,
    lastSeenAt: machine.lastSeenAt,
    // Describes the reading actually being shown, so it is only set when
    // that reading came from a person. A stale report, or one a live sensor
    // has overridden, is not on display and its age would only be
    // misleading — the field then means exactly one thing.
    crowdReportedAt: statusSource === 'crowd' ? machine.crowdReportedAt : null,
  };
}
