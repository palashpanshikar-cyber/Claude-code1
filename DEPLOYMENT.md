# Deploying GymPulse

Until now GymPulse has only run on a laptop on the gym's WiFi, which means
it works only while that laptop is awake and only for people on that same
network. This guide puts it on the internet so the app works from any
phone, on any network, whether or not your PC is on.

---

## What gets deployed

**One service, not two.** The backend serves the built frontend as static
files from the same origin it serves the API and WebSocket from.

That isn't just tidiness — it's load-bearing. `frontend/src/lib/api.js`
fetches relative paths (`/api/gyms`) and builds its WebSocket URL from
`window.location`, upgrading to `wss://` automatically on HTTPS. Because
of that, the frontend needs no build-time configuration and no API base
URL baked in: wherever you host it, it finds its own backend. Splitting
the two across separate hosts is possible but means setting `CORS_ORIGIN`
and reworking that file. Don't, unless you have a reason.

```
browser ──┐
          ├──> https://your-app.example ──> Express ──┬──> /api/*  REST
sensors ──┘         (one host)                        ├──> /ws     WebSocket
                                                      └──> /*      React app
```

---

## The one thing that will bite you: persistence

By default GymPulse stores everything in a single JSON file. Hosting
platforms run your app in a **container with an ephemeral filesystem** —
rebuilt from the image on every deploy, restart, and crash. Anything
written at runtime is gone.

So by default, **every gym and machine you create disappears the next time
the app restarts**, along with every device key you handed to a sensor.
The sensors keep POSTing keys the server no longer recognises and get 404s
forever.

There are two ways to fix it, and on a free tier only one of them works.

### Recommended: a free managed Postgres

Set `DATABASE_URL` and the app stores everything in Postgres instead of a
file. It picks the backend at startup, creates its own tables, and needs
no other configuration.

1. Create a free database at [neon.tech](https://neon.tech) or
   [supabase.com](https://supabase.com).
2. Copy its connection string — `postgresql://user:pass@host/dbname`.
3. Set it as `DATABASE_URL` in your host's environment settings. Set it
   **there, not in `render.yaml`** — it contains a password.
4. Redeploy. The log line `store: postgres` confirms it took.
5. Remove `SEED_ON_EMPTY`; there is nothing left to repopulate.

This is the only way to keep data on a free plan, and it's what makes
running real sensors viable without paying for hosting.

Two knobs you probably won't need: `DATABASE_SSL_NO_VERIFY=true` if your
provider presents a private CA (leaves the connection encrypted but
unauthenticated — set it only if required), and `DATABASE_POOL_MAX`
(default 5, sized for free tiers' low connection caps).

### Alternative: a persistent disk

Keeps the JSON store but puts the file on a volume that survives:

```
DATA_PATH=/data/data.json    # with a disk mounted at /data
```

The `Dockerfile` already defaults `DATA_PATH` to `/data/data.json` and
declares the volume. On most platforms, including Render, disks require a
**paid** instance — which is why Postgres is the recommendation above.

### Either way: one instance only

The JSON store assumes a single writer; two instances would each hold
their own copy in memory and overwrite each other's file. Postgres removes
that constraint at the storage layer, but the in-memory `lastBroadcastStatus`
map in `server.js` and the WebSocket fan-out are still per-process, so a
second instance would broadcast to only its own clients. Don't enable
autoscaling.

---

## Deploying to Render

`render.yaml` in the repo root is a blueprint, so Render configures itself
rather than making you fill in a form.

1. Push this repo to GitHub (already done: `Claude-code1`).
2. Go to [dashboard.render.com](https://dashboard.render.com) → **New** →
   **Blueprint**, and pick the repo. Render reads `render.yaml`.
3. Confirm the plan. The blueprint asks for a `starter` instance plus a
   1 GB disk, because free instances cannot mount disks — see above.
   Check Render's current pricing before confirming.
4. Deploy. First build takes a few minutes (it builds the frontend, then
   the backend image).
5. When it's live, open the URL. You'll see GymPulse with **no gyms** —
   expected, because your local `data.json` was never uploaded and
   shouldn't be. You create them in step 7.
6. **Get your admin token.** `render.yaml` sets `ADMIN_TOKEN` to
   `generateValue: true`, so Render generated a strong one for you.
   Dashboard → your service → **Environment** → reveal `ADMIN_TOKEN`.
7. Open `https://your-app.onrender.com/admin`, paste that token, and add
   your real gym and its machines. Copy each machine's `device_id` and
   `device_key` **when they're shown** — the key is displayed once and
   never again (regenerate if you lose one).

### Free tier, honestly

`render.yaml` targets the **free** plan, so the walkthrough above needs no
paid instance. What you get depends on whether you set `DATABASE_URL`.

**With `DATABASE_URL`** (recommended — see the persistence section):

- Your gyms, machines and device keys survive restarts.
- Still sleeps when idle: the first request after a quiet spell takes tens
  of seconds while the container boots. A sensor's status POST can time
  out against a sleeping instance, so expect occasional gaps in readings.
- Good enough for real sensors, with that caveat. `plan: starter` removes
  the sleeping.

**Without `DATABASE_URL`** (JSON file on an ephemeral filesystem):

- **Nothing you create survives a restart.** Gyms added through `/admin`
  are gone on the next wake.
- **Device keys are reissued on every restart**, so anything you flashed
  stops being recognised. Don't run sensors against this.
- Fine for showing someone the app from a phone; that's about it.

`SEED_ON_EMPTY=true` exists only for that second case. Without it a woken
instance serves an empty app whose only entry point is the admin panel;
with it, the demo gyms come back so the page is worth opening. It fires
only when the store is genuinely empty, so it cannot overwrite anything
you entered — but it papers over missing persistence rather than providing
it. Set `DATABASE_URL` and remove it.

### Other platforms

The `Dockerfile` is plain and portable — nothing in it is Render-specific.
**Fly.io** (`fly launch`, then `fly volumes create`) and **Railway** both
run it as-is. On any of them the checklist is the same: mount a volume,
set `DATA_PATH` into it, set `ADMIN_TOKEN`, keep it to one instance.

---

## Environment variables

| Variable | Required | Default | What it does |
|---|---|---|---|
| `ADMIN_TOKEN` | for `/admin` | *(unset)* | Shared password for the admin CRUD routes. **No default by design** — while unset, every admin route answers `503`, so the panel can never run open by accident. Use a long random string. |
| `DATABASE_URL` | recommended | *(unset)* | Postgres connection string. Set it and the app stores data in Postgres, creating its tables on boot; leave it unset and data goes to a JSON file. The only way to keep data on a free plan. Contains a password — set it in your host's dashboard, never in `render.yaml`. |
| `DATA_PATH` | if using the JSON store | `backend/data.json` | Where the JSON file lives. Ignored when `DATABASE_URL` is set. Point it at a mounted disk or lose your data on redeploy. |
| `DATABASE_SSL_NO_VERIFY` | no | *(unset)* | `true` skips TLS certificate verification for the database. Needed only by providers using a private CA; leaves the connection encrypted but unauthenticated. |
| `DATABASE_POOL_MAX` | no | `5` | Max Postgres connections. Kept low because free tiers cap them. |
| `PORT` | no | `3001` | Most platforms set this for you. |
| `NODE_ENV` | recommended | *(unset)* | `production` closes CORS to cross-origin browsers. Set by the `Dockerfile`. |
| `CORS_ORIGIN` | no | *(unset)* | Comma-separated origins to allow. Only needed if you host the frontend somewhere other than the backend. Doesn't affect sensors — they don't send `Origin`. |
| `CLIENT_DIR` | no | `../frontend/dist` | Where to find the built frontend. The default is already correct in the image. |
| `SEED_ON_EMPTY` | no | *(unset)* | Set to `true` to insert the demo gyms at boot **when the store is empty**. For disk-less free tiers, where a cold start would otherwise serve a blank app. Never overwrites existing data, but mints new device keys each time it fires — leave it unset once you have a disk. |

---

## Pointing your sensors at the deployed backend

Edit `config.h` on each device and change one line:

```c
// was
#define BACKEND_URL "http://192.168.1.50:3001"
// now
#define BACKEND_URL "https://your-app.onrender.com"
```

Use `https://`, no trailing slash. Both sketches detect the scheme and
switch between a plain and a TLS client automatically, so nothing else
changes.

Two things worth knowing:

- **Plain `http://` to a hosted backend will not work.** Hosts redirect
  HTTP to HTTPS, and these sketches don't follow redirects. You'd see the
  device log a `301`/`307` and the status never land.
- **TLS certificates aren't validated** (`setInsecure()` in both
  sketches). The alternative is pinning a certificate, and hosts renew
  every few months — a pinned sensor would go silent on renewal day, in a
  gym, with no console to explain why. The connection carries one
  machine's busy/open state, and its device key can only push status for
  that same machine, so a forged report costs a wrong icon and nothing
  more. Don't reuse this pattern for anything that carries real secrets.

Your gym's WiFi also has to let devices reach the internet. Guest networks
with client isolation usually still allow outbound HTTPS, which is all the
sensors need now — unlike the LAN setup, they no longer need to reach a
particular machine on the local network.

---

## Verifying a deployment

```bash
APP=https://your-app.onrender.com

curl -s $APP/api/health                      # {"ok":true}
curl -s $APP/api/gyms                        # [] until you add one
curl -so /dev/null -w '%{http_code}\n' $APP/admin       # 200 (deep link → app shell)
curl -so /dev/null -w '%{http_code}\n' $APP/api/admin/gyms  # 401 (403-gated, not open)
```

A `503` from that last one means `ADMIN_TOKEN` isn't set. A `200` would
mean it's running open — that shouldn't be possible, but if you ever see
it, stop and check your environment configuration.

Then open the app on your phone over cellular (not the gym WiFi) to prove
it no longer depends on your local network.

---

## Deploy checklist

- [ ] Persistent disk mounted, `DATA_PATH` pointing into it
- [ ] `ADMIN_TOKEN` set to a long random value, not a guessable one
- [ ] Exactly one instance — no autoscaling
- [ ] `/api/health` returns `{"ok":true}`
- [ ] `/api/admin/gyms` returns `401` without a token (not `503`, not `200`)
- [ ] Gyms and machines recreated through `/admin`
- [ ] Each sensor's `config.h` updated to the `https://` URL and reflashed
- [ ] App loads on cellular data
