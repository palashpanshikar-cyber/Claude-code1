# GymPulse (gym-tracker)

Track whether specific machines at a gym are open or in use, in real time,
using a small vibration-sensing pod mounted on each machine.

## Components

- `firmware/gym_tracker_esp8266_vibration/` — **recommended**: ESP8266 +
  SW-420 vibration switch firmware (~$8-14/unit). Detects motion, decides
  open/busy, reports to the backend over WiFi.
- `firmware/gym_tracker_esp32/` — alternative: ESP32 + MPU6050 accelerometer
  firmware (~$12-20/unit), for continuous motion data instead of an on/off
  switch. See `docs/HARDWARE_GUIDE.md` Section 9 for the tradeoffs.
- `backend/` — Node/Express API + a plain JSON file store + WebSocket.
  Devices POST status updates; the app reads current status and gets live
  pushes. (No native/compiled dependencies — installs cleanly everywhere,
  including Windows with no Python/build tools.)
- `frontend/` — GymPulse: a React web app (search, favorites, per-gym
  machine grid with status/zone filters, live status, notify-me-when-open,
  an admin panel, installable as a phone app).
- `docs/HARDWARE_GUIDE.md` — step-by-step guide to building and mounting
  the physical sensor.

## Quick start (software only, no hardware needed to try it)

```bash
# 1. Backend
cd backend
npm install
npm run seed        # creates demo gyms/machines, prints device_id/device_key pairs
ADMIN_TOKEN=changeme npm start   # listens on :3001 (HTTP + WebSocket at /ws)

# 2. Frontend (separate terminal)
cd frontend
npm install
npm run dev           # http://localhost:5173, proxies /api and /ws to :3001
```

`ADMIN_TOKEN` enables the `/admin` panel (add/edit/delete gyms and
machines from the app itself). Pick any string — it's the password you'll
type into `/admin`'s login screen. Leave it unset and the backend still
runs fine; `/admin` just responds "not configured" until you set it. On
Windows PowerShell, set it for the current session with
`$env:ADMIN_TOKEN="changeme"` before `npm start`, or inline for one run
with `$env:ADMIN_TOKEN="changeme"; npm start`.

Open http://localhost:5173 — you'll see every machine as "Offline" (no
device has reported yet). Simulate a device coming online:

```bash
curl -X POST http://localhost:3001/api/devices/<device_id>/status \
  -H 'Content-Type: application/json' \
  -H 'X-Device-Key: <device_key>' \
  -d '{"status":"busy","batteryPct":88,"rssi":-52}'
```

(Use a `device_id`/`device_key` pair from the `npm run seed` output.) The
web app updates live over the WebSocket — no refresh needed.

## Going from demo to a real gym

1. Clear the demo data and add your real gym(s)/machines via the `/admin`
   panel (set `ADMIN_TOKEN` first, see above) — each machine you create
   there shows its `device_id`/`device_key` once, which you'll flash onto
   its physical sensor.
2. Build and flash a physical sensor per `docs/HARDWARE_GUIDE.md` for each
   machine, using that device_id/device_key pair.
3. Deploy the backend somewhere reachable from the gym's WiFi (or the
   public internet, with HTTPS, for multi-location support).
4. Point `frontend`'s build at that backend URL (currently hardcoded to
   same-origin `/api` + `/ws` via the Vite dev proxy — for a production
   build, add an env-configurable API base URL).

## Status model

- `open` — no motion detected recently.
- `busy` — motion detected within the last `IN_USE_HOLD_MS` window
  (default 90s) — see the firmware for tuning.
- `offline` — the backend hasn't heard from the device in 90s, regardless
  of the last status it reported. Computed server-side so a device that
  loses power mid-"busy" doesn't get stuck showing as occupied forever.
- `unknown` — a machine that has a device provisioned but has never
  reported at all.

## App features

- **Favorites**: tap the star on any gym card (or in a gym's detail header)
  to pin it as your "home gym" — it sorts first on the home screen. Stored
  in the browser's localStorage, no account needed.
- **Notify me when open**: on a busy machine, tap the bell to be told the
  moment it frees up. Where the server has VAPID keys configured this uses
  real Web Push, handled by the service worker, so it fires even with the
  browser fully closed — see DEPLOYMENT.md to set that up. Without those
  keys it falls back to the original WebSocket-based notification, which
  only fires while a tab is running. The server decides which is in play
  and the app adapts, so a deployment without push keys still works.
- **Report a machine's status**: anyone can tap "In use" or "It's free" on
  a machine, which is what gives the app real data before any sensor
  hardware exists. A live sensor always overrides a person's report, and
  reports expire after 20 minutes; crowd-sourced readings are labelled as
  such so they're never mistaken for a live measurement.
- **Honest loading states**: the app distinguishes a server still waking
  up from a request that failed from a genuinely empty list, and shows
  last-known data (labelled with its age) rather than a blank screen while
  a sleeping free-tier host boots.
- **Admin panel** (`/admin`): add/edit/delete gyms and machines from the
  app itself. Gated by `ADMIN_TOKEN` (see Quick Start above) — a single
  shared password, not a full user-account system. A machine's
  `device_id`/`device_key` is shown once at creation (or via "regenerate
  key" if lost) and never re-servable afterwards, same as a GitHub token.

## Deploying

The Quick Start above runs two dev servers on one machine, which only
works while that machine is awake and only for people on the same WiFi.
To put GymPulse on the internet, see **[DEPLOYMENT.md](DEPLOYMENT.md)** —
`Dockerfile` and `render.yaml` in this directory are ready to use.

A deployment runs as a **single service**: the backend serves the built
frontend from the same origin as the API and the WebSocket, so there's no
API base URL to configure anywhere. To try that mode locally:

```bash
cd frontend && npm run build     # produces frontend/dist
cd ../backend && ADMIN_TOKEN=changeme NODE_ENV=production npm start
# whole app on http://localhost:3001 — no Vite server needed
```

Two things to know before deploying, both covered in detail in
DEPLOYMENT.md. First, storage: by default data lives in a JSON file that a
container filesystem erases on every deploy, so set `DATABASE_URL` to a
free managed Postgres (neon.tech, supabase.com) and the app switches
backends on its own and creates its tables on boot — that's the only way
to keep data on a free plan. Second, sensors must be repointed at the
`https://` URL, which both firmware sketches handle by detecting the
scheme.

## Frontend origin

`frontend/`'s design (GymCard/MachineCard layout, search, zone filters,
pull-to-refresh) originated from a Base44 app called GymPulse, ported here
to talk to this repo's own backend instead of Base44's hosted one. The
account/login system from that original app isn't included — this backend
has no user accounts yet, so the app is open-access. See `frontend/src/lib/api.js`
for the adapter that maps this backend's field names/status values to the
shape the UI expects.
