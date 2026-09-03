# Muse.

An immersive glassmorphism music player fused with a real-time social hub —
search, curate, and **listen together, in the same groove at the same moment**.

A full-stack app: a React front end, an Express + Socket.io back end, and a
shared clock in the middle that everything is keyed to. Rooms let people listen
synchronously, chat, and call over WebRTC.

> **Status:** Phase 0 (scaffold & salvage) complete. Built on the proven
> realtime core salvaged from `Huddle`, wearing the identity of `Muse._v1`.
> See the build plan for the full roadmap. The heavy UI re-skin to the
> Muse.-forward hybrid aesthetic lands in Phase 1.

---

## Running it

Two processes: a Vite dev server for the front end, and the API. One command
starts both.

```bash
npm install
npm run server:install
npm --prefix server run generate   # Prisma client
npm --prefix server run db:push    # create the SQLite database
npm run dev:all
```

Front end on `http://localhost:5173`, API on `http://localhost:4000`. In
development Vite proxies `/api`, `/socket.io` and `/uploads` to the API, so
everything is same-origin and the session cookie works with no configuration.

`server/.env` is created during setup — `JWT_SECRET` is the only value the
server refuses to start without. Everything else (YouTube search, TURN relay)
is optional and switches on a feature rather than being required.

---

## The starter library

Muse._v1's twenty tracks are seeded into `server/uploads/`, which is the audio
library the app reads at runtime — drop an audio file in and it appears, no
import step. Cover art from V1 is stashed in `src/assets/seed/` for the richer,
metadata-complete catalogue coming in Phase 1.

---

## What's inside

| | |
| --- | --- |
| **Listen** | A shared queue with a vinyl record view, a live visualiser, and time-synced lyrics that follow the song. |
| **Rooms** | Private by default, joined by code. Everyone holds the same playhead. |
| **Chat & call** | Text alongside the music, plus voice and video over WebRTC. |

---

## How the sync holds

There is no host — anyone in the room can drive, and the server is the single
source of truth. Each client measures its clock offset from the server, and a
shared drift-correction loop nudges playback rate to converge, seeking only
when a gap is already large enough to see. A stalled player is left alone until
it recovers, so one buffer never spirals into a seek-loop.

---

## Structure

```
src/                React front end (features/, components/, lib/, pages/)
server/src/         Express + Socket.io API
  services/         the real work — rooms, music, lyrics, sync
  sockets/          one gateway per live feature, all on one connection
  models/           Prisma access
Reference projects/ Muse._v1 + Huddle — read-only, kept for salvage
```

Everything live rides **one** socket connection — presence, chat, the call's
signalling, and music. One connection, one handshake, membership checked the
same way for all of them.
