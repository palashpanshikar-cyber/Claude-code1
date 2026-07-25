import crypto from 'node:crypto';
import webpush from 'web-push';
import {
  listWatchersOfMachine,
  removeMachineWatch,
  deletePushSubscriptionByEndpoint,
} from './store.js';

// Real Web Push, so "notify me when this is free" fires with the browser
// fully closed. The previous implementation watched the WebSocket from the
// page, which meant it only worked while the tab was alive — the one thing
// you cannot rely on for someone who put their phone away.
//
// Push needs a VAPID keypair identifying this server to the browser's push
// service. Without one configured, push is simply off and the frontend
// keeps using its WebSocket fallback, so the app still works.

const publicKey = process.env.VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;
// Push services want a contact for the application server, so they have
// someone to reach about a misbehaving sender.
const subject = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';

export const pushEnabled = Boolean(publicKey && privateKey);

if (pushEnabled) {
  webpush.setVapidDetails(subject, publicKey, privateKey);
}

export function pushPublicKey() {
  return pushEnabled ? publicKey : null;
}

function toWebPushSubscription(row) {
  return {
    endpoint: row.endpoint,
    keys: { p256dh: row.p256dh, auth: row.auth },
  };
}

// A push endpoint URL is a bearer capability — anyone holding it can send
// this browser notifications — so it must not go in a log. The host says
// which push service is involved, which is the part worth knowing, and the
// short digest is enough to follow one subscription across log lines.
export function describeEndpoint(endpoint) {
  let host = 'unknown';
  try {
    host = new URL(endpoint).host;
  } catch {
    // Keep the placeholder.
  }
  const digest = crypto.createHash('sha256').update(endpoint).digest('hex').slice(0, 8);
  return `${host}#${digest}`;
}

/**
 * Notifies everyone watching this machine that it's free, then clears the
 * watches — the request was for one alert, not a subscription to every
 * future transition.
 *
 * Never throws. A push service being slow or rejecting a stale endpoint
 * must not turn a device's status report into a 500; the status update
 * itself already succeeded and matters more.
 */
export async function notifyMachineOpen(machine) {
  if (!pushEnabled) return { sent: 0, expired: 0 };

  let subscriptions;
  try {
    subscriptions = await listWatchersOfMachine(machine.id);
  } catch (err) {
    console.error('push: could not load watchers:', err.message);
    return { sent: 0, expired: 0 };
  }
  // Logged even when there is nobody to notify. "Nobody was watching" and
  // "everyone was notified" used to produce identical output — no output —
  // which made a silent phone impossible to diagnose from the logs.
  if (subscriptions.length === 0) {
    console.log(`push: ${machine.name} (id ${machine.id}) went open — no watchers registered`);
    return { sent: 0, expired: 0, failed: 0 };
  }
  console.log(
    `push: ${machine.name} (id ${machine.id}) went open — notifying ${subscriptions.length} watcher(s): ` +
      subscriptions.map((s) => describeEndpoint(s.endpoint)).join(', '),
  );

  const payload = JSON.stringify({
    title: 'Machine available',
    body: `${machine.name} is now open.`,
    machineId: machine.id,
    gymId: machine.gymId,
  });

  let sent = 0;
  let expired = 0;
  let failed = 0;

  // Each watch is retired individually, by outcome. Clearing them all
  // regardless would mean a push service having a bad minute silently
  // consumed the alert someone was waiting for.
  await Promise.all(subscriptions.map(async (row) => {
    try {
      await webpush.sendNotification(toWebPushSubscription(row), payload);
      sent++;
      // Delivered, so the request is fulfilled: this was an ask for one
      // alert, not a subscription to every future transition.
      await removeMachineWatch(row.id, machine.id).catch(() => {});
    } catch (err) {
      // 404 and 410 mean the browser threw the subscription away — site
      // data cleared, PWA uninstalled, or the push service retired the
      // endpoint. Those never recover, so drop the subscription instead of
      // retrying it on every future transition. Its watches cascade.
      if (err.statusCode === 404 || err.statusCode === 410) {
        expired++;
        console.warn(
          `push: ${describeEndpoint(row.endpoint)} is gone (${err.statusCode}) — deleting subscription`,
        );
        await deletePushSubscriptionByEndpoint(row.endpoint).catch(() => {});
      } else {
        // Anything else may be transient, so the watch stays and a later
        // transition tries again.
        failed++;
        console.error(
          `push: send to ${describeEndpoint(row.endpoint)} failed (${err.statusCode ?? 'no status'}):`,
          err.message,
        );
      }
    }
  }));

  console.log(`push: delivered ${sent}, expired ${expired}, failed ${failed}`);
  return { sent, expired, failed };
}
