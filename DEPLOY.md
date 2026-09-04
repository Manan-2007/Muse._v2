# Deploying Muse. (and making it multi-device)

This is the whole picture and the exact steps. It takes about 20 minutes and
costs nothing on the free tiers.

## The short version

Muse. is three parts, and they go to three places:

| Part | What it is | Where it goes | Why |
| --- | --- | --- | --- |
| **Frontend** | the React/Vite app in `src/` | **Vercel** | Vercel is built for static frontends |
| **Backend** | the Express + **Socket.io** server in `server/` | **Render** (or Railway/Fly) | realtime rooms need a long-running process with WebSockets — Vercel's serverless functions can't hold one open |
| **Database** | your accounts, rooms, playlists, play history | **Neon** (hosted Postgres) | a cloud DB is what makes one account work on every device |

**Why not Vercel for everything?** Vercel runs serverless functions — they spin
up per request and die. Socket.io needs a socket that stays open, and a local
SQLite file doesn't exist on a serverless box. So the API + DB live elsewhere,
and Vercel serves the app.

**Why not Firebase?** Firebase would mean rewriting the entire backend — the
Prisma data model becomes Firestore documents, the Express/JWT auth becomes
Firebase Auth, and the Socket.io sync becomes Firebase Realtime (or still needs
a separate socket service). That's throwing away a working backend to solve a
problem — "a shared database" — that a hosted Postgres solves in two minutes
with zero code changes. So: keep the backend, host the database.

## How multi-device works

There's nothing special to build. Accounts already live in the database and
auth is already a JWT (a token the app keeps, not a device-bound session). The
only reason it isn't multi-device today is that the database is a **file on your
laptop** (SQLite). Move that database to the cloud (Neon) and it just works: log
in with the same email + password on your phone, your laptop, anywhere, and it's
the same account, same playlists, same history — because they all read and write
the one cloud database. That's the entire fix, and it's already done in code
(the Prisma provider is now `postgresql`).

---

## Step 1 — Database (Neon, ~3 min)

1. Sign up at **https://neon.tech** (free).
2. Create a project. Copy its **pooled** connection string — it looks like
   `postgresql://user:pass@ep-xxx.region.aws.neon.tech/dbname?sslmode=require`.
3. Locally, put it in `server/.env` as `DATABASE_URL=...`, then create the
   tables:
   ```bash
   npm --prefix server run db:push
   ```
   Your local dev now uses the cloud DB too — which is handy, because it means
   your laptop and your deployed app share data while you build.

## Step 2 — Backend (Render, ~8 min)

The repo ships a `render.yaml` blueprint, so most of this is filled in for you.

1. Push this repo to GitHub (already done: `Manan-2007/Muse._v2`).
2. At **https://render.com** → **New → Blueprint**, pick the repo. Render reads
   `render.yaml` and proposes the `muse-api` service.
3. Set the env vars it asks for (the ones marked `sync: false`):
   - `DATABASE_URL` — the Neon string from Step 1.
   - `CLIENT_ORIGIN` — leave blank for now; you'll set it in Step 4.
   - `YOUTUBE_API_KEY` — optional (search works without it via the keyless
     fallback; a key just makes search more reliable).
   - `JWT_SECRET` is generated for you; `CROSS_SITE` is preset to `true`.
4. Deploy. When it's live you'll get a URL like `https://muse-api.onrender.com`.
   Check `https://muse-api.onrender.com/api/health` returns `{"ok":true}`.

> Free Render services sleep after inactivity and take ~30s to wake on the first
> request. Fine for a personal app; bump the plan if that bothers you.

## Step 3 — Frontend (Vercel, ~5 min)

1. At **https://vercel.com** → **Add New → Project**, import the same repo.
2. Vercel reads `vercel.json` (framework Vite, build `npm run build`, output
   `dist`). Leave those as-is.
3. Add one **Environment Variable**:
   - `VITE_API_URL` = your Render URL, e.g. `https://muse-api.onrender.com`
     (no trailing slash). This tells the app to talk to the backend cross-origin
     and use bearer-token auth automatically.
4. Deploy. You'll get a URL like `https://muse-v2.vercel.app`.

## Step 4 — Introduce them

1. Back on Render, set `CLIENT_ORIGIN` to your Vercel URL
   (`https://muse-v2.vercel.app`, no trailing slash) and redeploy. This lets the
   browser's requests through CORS and lets the session cookie work across the
   two origins.
2. Open the Vercel URL, sign up, then sign in on your phone with the same email
   and password. Same account. Done.

---

## Notes and gotchas

- **Uploaded audio** (`server/uploads/`) sits on the server's disk, which is
  ephemeral on Render's free tier — uploads vanish on redeploy/restart. Search,
  links, playlists, rooms and everything else are unaffected. If you want
  uploads to persist, move them to object storage (S3/R2) later; it's isolated
  to `upload.service.ts`.
- **Voice/video calls** between people on different networks need a TURN relay —
  see the `METERED_*` / `TURN_*` vars in `server/.env.example`. Without one,
  calls connect only when a direct path exists (same Wi-Fi). Listening,
  watching, screen share and chat don't need it.
- **Env, never commit secrets.** `server/.env` is gitignored. Real values live
  only in the Render/Vercel dashboards.
- **One database for dev and prod** is the simplest setup and makes multi-device
  true even while developing. If you'd rather keep them separate, make a second
  Neon project and use its URL locally.
