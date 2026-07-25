// "Notify me when this is free", by real Web Push where the server has
// VAPID keys configured, falling back to the original WebSocket-based
// notification where it doesn't.
//
// The distinction matters. Push is handled by the service worker, so it
// fires with the browser fully closed — which is the whole point for
// someone who put their phone in a locker. The fallback only fires while a
// tab is alive, foreground or background, and dies with the browser.
//
// The server decides which is available (GET /api/push/config) rather than
// this being a build-time flag, so a deployment that has not set up VAPID
// keys still gets working, if weaker, notifications.

export async function ensureNotificationPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

// Foreground fallback, used when push isn't configured.
export function notify(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body, icon: '/icon-192.png' });
  } catch {
    // Some browsers (mostly mobile Chrome) throw on `new Notification` and
    // require a service-worker-registered notification instead. Silently
    // skip rather than crash the update handler over a nice-to-have.
  }
}

let configPromise;
export function getPushConfig() {
  // Cached: every bell tap would otherwise re-request an answer that
  // cannot change without a redeploy.
  configPromise ??= fetch('/api/push/config')
    .then((r) => (r.ok ? r.json() : { enabled: false }))
    .catch(() => ({ enabled: false }));
  return configPromise;
}

export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window;
}

// The VAPID public key travels as base64url but subscribe() wants raw bytes.
function urlBase64ToUint8Array(base64) {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/**
 * Returns this browser's push subscription, creating it if needed, or null
 * if push isn't available. Reuses an existing subscription rather than
 * re-subscribing, since the endpoint is the server's key for it.
 */
export async function getPushSubscription() {
  if (!pushSupported()) return null;
  const config = await getPushConfig();
  if (!config.enabled || !config.publicKey) return null;

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  if (existing) return existing;

  try {
    return await registration.pushManager.subscribe({
      // Required by browsers: every push must be shown to the user, so
      // this cannot be used for silent background traffic.
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(config.publicKey),
    });
  } catch (err) {
    // Blocked permission, a browser that advertises PushManager without a
    // usable push service, or iOS Safari outside an installed PWA. Logged
    // rather than swallowed: when someone reports "the bell did nothing",
    // this message is the whole diagnosis, and a silent failure here is
    // indistinguishable from working.
    console.warn('push subscribe failed, falling back to in-tab notifications:', err);
    return null;
  }
}

async function postJson(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok && res.status !== 204) throw new Error(`${path} failed: ${res.status}`);
  return res.status === 204 ? null : res.json();
}

export async function watchMachinePush(machineId) {
  const subscription = await getPushSubscription();
  if (!subscription) return false;
  await postJson('/api/push/watch', { subscription, machineId });
  return true;
}

export async function unwatchMachinePush(machineId) {
  const subscription = await getPushSubscription();
  if (!subscription) return false;
  await postJson('/api/push/unwatch', { subscription, machineId });
  return true;
}

// Restores bell state after a reload: the watch lives on the server, so
// without this the icon would read as off while a notification is still on
// its way.
export async function fetchPushWatchedMachineIds() {
  if (!pushSupported()) return null;
  const config = await getPushConfig();
  if (!config.enabled) return null;

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return [];

  try {
    const { machineIds } = await postJson('/api/push/watched', { subscription });
    return machineIds ?? [];
  } catch {
    return [];
  }
}
