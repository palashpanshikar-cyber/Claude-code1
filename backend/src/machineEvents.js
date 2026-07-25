import { broadcast } from './hub.js';
import { notifyMachineOpen } from './push.js';

// The one path a machine update takes out of the server. Every caller that
// changes a status goes through here — a device report, a crowd report, the
// offline sweep — so the WebSocket broadcast and the push notification
// cannot drift apart as more of them appear.
//
// `statusChanged` gates the notification. A device reports on a timer, not
// only on transitions, so a machine sitting open would otherwise re-notify
// on every report. Clearing the watches after the first send already limits
// the damage to a wasted query, but not asking is better than asking and
// finding nothing.
export async function publishMachineUpdate(machine, { statusChanged = false } = {}) {
  broadcast({ type: 'machine_update', machine });

  if (statusChanged && machine.status === 'open') {
    // Awaited so failures are logged, but notifyMachineOpen never throws:
    // a push service having a bad day must not fail the status report that
    // triggered it.
    await notifyMachineOpen(machine);
  } else if (machine.status === 'open') {
    // The commonest reason a watched machine doesn't notify: it was already
    // open, so nothing transitioned. Worth a line, because from the outside
    // this is indistinguishable from a broken push setup.
    console.log(
      `push: ${machine.name} (id ${machine.id}) reported open but was already open — no notification sent`,
    );
  }
}
