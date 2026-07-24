// Client-side-only "notify me when open": rides the WebSocket connection
// that's already open while the gym detail page is mounted, rather than
// standing up real Web Push (VAPID keys, a subscription store on the
// backend, service-worker push handling). Tradeoff: this only fires while
// the browser/tab is still running (foreground or backgrounded) — it does
// NOT wake a fully-closed browser the way true push notifications would.
// Good enough for "I'm waiting around, tell me when it frees up"; would
// need real Web Push for "notify me even if I've closed the app".

export async function ensureNotificationPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

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
