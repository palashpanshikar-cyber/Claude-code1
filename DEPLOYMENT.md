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

GymPulse stores everything in a single JSON file. Hosting platforms run
your app in a **container with an ephemeral filesystem** — it is rebuilt
from the image on every deploy, restart, and crash. Anything written at
runtime is gone.

Without a persistent disk, **every gym and machine you create disappears
the next time you deploy**, along with every device key you handed to a
sensor. The sensors keep POSTing keys the server no longer recognises and
get 404s forever.

The fix is to mount a persistent volume and point `DATA_PATH` inside it:

```
DATA_PATH=/data/data.json    # with a disk mounted at /data
```

`Dockerfile` and `render.yaml` both already do this. Just don't remove it,
and don't deploy to a plan that has no disk while expecting data to
survive. On most platforms persistent disks require a paid instance —
that's the real cost of "works when my PC is off."

**Related constraint:** the JSON store assumes a single writer. Run
**one instance only**. Two instances would each hold their own copy of the
data in memory and overwrite each other's file — do not enable autoscaling
or set a replica count above 1. If you outgrow that, the comment at the
top of `backend/src/store.js` is the place to start swapping in a real
database.

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

Render's free instances spin down after inactivity and cold-start on the
next request, taking tens of seconds. For this app that means a sensor's
status POST can time out against a sleeping instance, and the first phone
to open the app in a while waits through the wake-up. Free is fine for
showing someone the app; it is not fine for sensors you expect to be
accurate. And free gets you no disk, so see the persistence section again.

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
| `DATA_PATH` | in production | `backend/data.json` | Where the JSON store lives. Point this at a mounted disk or lose your data on redeploy. |
| `PORT` | no | `3001` | Most platforms set this for you. |
| `NODE_ENV` | recommended | *(unset)* | `production` closes CORS to cross-origin browsers. Set by the `Dockerfile`. |
| `CORS_ORIGIN` | no | *(unset)* | Comma-separated origins to allow. Only needed if you host the frontend somewhere other than the backend. Doesn't affect sensors — they don't send `Origin`. |
| `CLIENT_DIR` | no | `../frontend/dist` | Where to find the built frontend. The default is already correct in the image. |

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
