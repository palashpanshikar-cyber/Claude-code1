# GymPulse — Migration Note

A chronological record of how this project got to its current state,
including what changed, why, and what it replaced. Pairs with
`HANDOFF.md` (current state + how to continue) — this file explains how we
got here.

---

## 1. Initial build: gym-tracker from scratch

Built a complete vertical slice from nothing:

- **Backend**: Node/Express REST API + SQLite (`better-sqlite3`) +
  WebSocket for live push. Endpoints for gyms, machines, and a
  device-status-ingestion endpoint authenticated per-device
  (`X-Device-Key` header, checked against a key issued at provisioning
  time).
- **Frontend**: a plain React (Vite) app — gym list, machine grid,
  color-coded status cards, WebSocket live updates with polling fallback.
- **Firmware**: ESP32 + MPU6050 accelerometer. Continuous motion-energy
  sampling (moving RMS of acceleration deltas) with a threshold and a
  hysteresis hold-time, reporting `available`/`in_use` over WiFi/HTTP.
- **Hardware guide**: BOM, wiring, assembly, mounting-per-machine-type,
  calibration procedure.

Caught and fixed during initial build: a firmware startup bug where
`millis()` being small right after boot made the device briefly report
"in use" before any real motion sample ever arrived (fixed with an
`everMoved` guard flag).

## 2. PWA support added

Added `manifest.webmanifest`, a service worker (`sw.js`, network-first,
only caches the static shell — never API/WS data), and generated app
icons, so the web app can be "Added to Home Screen" on a phone and behave
like an installed app rather than a bookmark.

## 3. Migration: `better-sqlite3` → plain JSON file store

**Why:** `better-sqlite3` needs a native addon compiled via `node-gyp` at
install time (Python + a C++ toolchain). This failed repeatedly on the
user's Windows machine, which had no Python installed — a `npm install`
blocker with no quick fix short of installing a multi-GB toolchain.

**What changed:**
- Removed `better-sqlite3` from `backend/package.json` entirely.
- Replaced `backend/src/db.js` (SQL queries via `better-sqlite3`) with
  `backend/src/store.js` — a hand-rolled JSON-file-backed store exposing
  the same operations (list/get/insert/update/delete for gyms and
  machines, status events) as plain functions instead of SQL strings.
- Rewrote all routes (`gyms.js`, `machines.js`, `devices.js`), `seed.js`,
  and `server.js`'s offline-detection sweep to call the new store
  functions instead of `db.prepare(...).all()/.get()/.run()`.
- Data now persists to `backend/data.json` instead of a `.db` file.

**Result:** `npm install` in `backend/` now installs ~71 packages with
zero native compilation, works identically on a fresh Windows machine
with no Python/build tools.

## 4. Discovery: a pre-existing Base44 app, "GymPulse"

The user had already built a more polished version of this same concept
on Base44 (a no-code/AI app builder) before this project started — full
auth (login/register/password reset), a `User` entity with roles, a
proper `Gym`/`Machine` data model (including a `device_id` field —
designed for the same physical-tracker idea independently), shadcn/ui
component library, search, pull-to-refresh, dark mode.

Decision (user's choice, given options): **use GymPulse's UI, wired to our
own backend** — not the reverse, and not developing GymPulse further on
Base44's own hosted backend.

## 5. Migration: custom frontend → GymPulse UI

**What changed:**
- Replaced almost all of `frontend/src/` with GymPulse's design: `Home`
  and `GymDetail` pages, `GymCard`/`MachineCard`/`PullToRefresh`/
  `ScrollToTop` components, Tailwind + CSS-variable theme tokens,
  framer-motion route transitions.
- **New adapter layer** (`frontend/src/lib/api.js`): since GymPulse's
  original data layer talked to Base44's hosted SDK
  (`db.entities.Gym.list()`, snake_case fields, its own status
  vocabulary), this file now talks to our own REST API and WebSocket,
  translating field names (`gymId` → `gym_id`, `machineType` →
  `machine_type`, epoch ms → ISO date string) so components never see the
  backend's raw shape.
- **Removed the Base44 auth system entirely** — no login, registration,
  password reset, protected routes, or account/profile sheet. Our backend
  has no user-account system, and building one wasn't in scope; the app
  is open-access. (`AuthContext`, `ProtectedRoute`, `Login`, `Register`,
  `ForgotPassword`, `ResetPassword`, `UserNotRegisteredError`,
  `AuthLayout`, `GoogleIcon`, `ProfileSheet` were all dropped, not
  ported.)
- **Trimmed the dependency footprint drastically**: the original Base44
  export had a "kitchen sink" `package.json` (Stripe, three.js, jspdf,
  html2canvas, moment, react-quill, react-leaflet, recharts, the full
  shadcn/ui component set — most unused by the actual GymPulse pages).
  Kept only what's actually imported: react-router-dom, framer-motion,
  lucide-react, clsx/tailwind-merge (for the `cn()` helper),
  tailwindcss(+animate). Frontend install went from a huge dependency
  tree to ~140 packages.
- Fixed two build-breaking artifacts from the Base44 export in the
  process: `vite.config.js` referenced an undefined `base44(...)` plugin
  function with no import (Base44-specific, meaningless outside their
  platform); several files (`README.md`, `AGENTS.md`,
  `src/api/base44Client.js`, several pages) had a stray line of mock-DB
  JS prepended — a cosmetic export glitch on Base44's end, harmless but
  cleaned up.

**Renamed status vocabulary to match GymPulse:** `available`/`in_use` →
`open`/`busy` (`offline`/`unknown` unchanged). Propagated through:
`backend/src/routes/devices.js` (`VALID_STATUSES`), both firmware
sketches' status literals and comments, `README.md`, `docs/HARDWARE_GUIDE.md`.

**Backend additions to support the GymPulse data model:**
- Added an optional `zone` field to machines (store, seed data,
  serialization) — GymPulse's UI has per-gym zone filter buttons
  (Free Weights / Strength Zone / Cardio Zone / Functional Area).
- Added a single-gym `GET /api/gyms/:gymId` route (GymDetail's header
  needs gym info, not just the list).
- Added live-computed `openMachines`/`totalMachines` counts to the gyms
  list response (derived from current machine statuses on every request,
  so they can't drift out of sync — not cached fields).
- Added optional `city` field to gyms (GymCard displays it).

## 6. Cheaper firmware variant added: ESP8266 + SW-420

**Why:** asked for cheaper options a solo hobbyist could build. Presented
three alternatives (crowdsourced/no-hardware, cheaper sensor swap, single
camera); the cheaper-sensor-swap direction was chosen.

**What changed:**
- New sketch: `firmware/gym_tracker_esp8266_vibration/`. Instead of
  continuous accelerometer sampling, counts debounced digital edge
  transitions from an SW-420 vibration switch module within a rolling
  window, comparing the count to a threshold — simpler code, no I2C, no
  floating-point math, ~half the per-unit cost (~$8-14 vs ~$12-20).
  Deliberately edge-counts in either direction (not a fixed polarity) to
  be robust to cheap SW-420 clones disagreeing on whether idle is
  high or low.
- `docs/HARDWARE_GUIDE.md` restructured to lead with this build; the
  original ESP32+MPU6050 path moved to a documented "Alternative" section
  for anyone who already has that hardware or wants continuous motion
  data.
- The original ESP32 sketch's `available`/`in_use` → `open`/`busy` rename
  (see #5) was applied to this new sketch too, from the start.

## 7. Feature additions (post-integration)

Requested together, sequenced deliberately (app-level features first;
App Store/Play Store explicitly deferred as a separate later milestone —
see reasoning in `HANDOFF.md`).

- **Admin panel** (`/admin`): full CRUD for gyms and machines from the app
  itself. New backend: `backend/src/adminAuth.js` (single shared
  `ADMIN_TOKEN` env var, no hardcoded default, admin routes 503 if unset —
  never runs open by accident) and `backend/src/routes/admin.js`. New
  store functions: `updateGym`, `deleteGym` (cascades to that gym's
  machines and their status history), `updateMachine`,
  `deleteMachine`, `regenerateMachineKey`. A machine's `device_key` is
  only ever returned in plaintext once, at creation or explicit
  regeneration — never re-servable afterward, same UX pattern as a GitHub
  personal access token.
- **Favorites**: `frontend/src/lib/favorites.js`, a localStorage-only
  "home gym" id. Starring a gym on its card or detail header pins it
  first in the home list with a badge — no backend/account involved.
- **Visual polish**: discovered the backend already collected
  battery-level telemetry from devices but the frontend adapter silently
  dropped it — added `battery_pct` through the adapter and a low-battery
  (<20%) warning badge on `MachineCard`. Replaced `GymDetail`'s bare
  loading spinner with skeleton placeholders matching the machine-row
  layout.
- **Notify-me-when-open**: tapping a bell on a busy `MachineCard` requests
  browser notification permission and watches that machine; when a
  WebSocket update reports it `open`, fires a `Notification` and clears
  the watch. Deliberately client-side/WebSocket-based rather than real Web
  Push — documented tradeoff: only fires while the tab is open
  (foreground or background), not if the browser is fully closed.

  **Bug caught during testing, fixed:** the first implementation called
  `notify()` (a side effect) from inside a `setState` functional updater.
  React 18 StrictMode intentionally double-invokes updater functions in
  development specifically to catch non-pure updaters — which is exactly
  what happened: the notification fired twice per real event. Fixed by
  moving the "have I already handled this" check-and-mutate into a
  `useRef`-backed `Set` (mutable, side-effect-safe), with the `useState`
  copy existing only to trigger re-renders for the bell icon's visual
  state.

## Net effect

Same backend contract throughout (device auth, WebSocket broadcast
shape) — everything above is either infrastructure hardening (SQLite
removal), a UI replacement with an adapter layer absorbing the
difference, or additive features. Nothing in this list required
reworking the device-facing HTTP contract that the firmware speaks;
firmware written early in the project against `available`/`in_use`
needed only its status-string literals updated, not its logic.
