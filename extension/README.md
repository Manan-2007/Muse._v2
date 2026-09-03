# Huddle — Netflix

Holds a Netflix tab to the same moment as everyone else in a Huddle room.

Netflix cannot be embedded (`X-Frame-Options: DENY`) and exposes no public
playback API, which is why the app itself can only offer a synced countdown for
it. An extension can do better, because a content script runs *inside*
netflix.com with permission to read its page.

The thing that makes this legal and possible: **the decoded picture is walled
off behind DRM, but the playback clock is not.** `currentTime`, `paused` and
`duration` are ordinary properties. This reads a clock and nudges play, pause
and seek — the same three things your own keyboard does. It never touches the
stream, your login, or the content.

## Setup

There are two steps, and neither involves typing a token.

1. **Load the extension.** `chrome://extensions` → Developer mode → *Load
   unpacked* → pick this `extension/` folder. (To put it on someone else's
   machine, see **Other devices** below.)
2. **Allowlist it on the API.** Open the popup and copy the
   `chrome-extension://…` origin printed at the bottom, add it to
   `CLIENT_ORIGIN` in the server's `.env`, and restart the server:

   ```
   CLIENT_ORIGIN=https://your-app.vercel.app,chrome-extension://<id>
   ```

   The id is assigned by Chrome and differs per machine, so each person's has
   to be added. Without it the server correctly refuses the connection.

That's it. Open your Huddle room in a tab and the extension configures itself
from the page — the API, the room, and a session token it requests for itself.
Then open a title on Netflix: a panel appears over the player with **Start the
room on this**. Everyone else opens the same title on their own account and
their tab falls in step on its own.

## What talks to what

| Piece | World | Job |
|---|---|---|
| `src/worker.js` | extension | The socket, the clock offset, and telling the API what the room is watching |
| `src/netflix.js` | isolated | Drift correction, and deciding who moved the film |
| `src/overlay.js` | isolated | The on-page panel |
| `src/bridge.js` | **main** | Netflix's own player API |
| `src/handoff.js` | app origin | Reads the page's config and configures the extension |
| `src/popup.js` | popup | Status, and a manual fallback |

Three details that are load-bearing rather than incidental:

**The socket lives in the worker.** Opened from a content script it would
carry `Origin: https://www.netflix.com`, so making it work would mean
allowlisting netflix.com on the API — a wide door for one tab's convenience.
From the worker the origin is the extension's own id, which no page can forge.

**`bridge.js` is the only file that touches Netflix's internals.** Setting
`video.currentTime` alone does not hold: their player owns a state machine and
winds an unauthorised position back a moment later, so this drives their own
player API instead. It falls back to the raw `<video>` element when their
internals move, which they will.

**The content scripts match all of netflix.com, not just `/watch/*`.** Netflix
is a single-page app — pressing Play routes there with `history.pushState`, not
a real navigation, and Chrome only injects a manifest-declared script on an
actual page load. Matching broadly and watching the path from inside the
already-running script is what makes the panel appear on the title you open.

## Other devices

```bash
node extension/scripts/package.mjs
```

Writes `extension/dist/huddle-netflix-<version>.zip`. Send it over, unzip, and
*Load unpacked* on that machine. Each person then adds their own
`chrome-extension://` origin to `CLIENT_ORIGIN` (see Setup step 2), since
Chrome assigns a different id per install.

Everyone needs their own Netflix subscription and login. Nothing is shared or
proxied — the room only ever agrees on a timestamp.

## Deployment

Two people on two devices need one server both can reach, which a laptop on a
desk cannot offer. `server/Dockerfile` builds the API for anywhere that runs a
container. The two things that matter:

- **Mount a volume at `/data`.** SQLite and uploaded video both live on disk;
  without one, every redeploy is a factory reset. `DATABASE_URL` and
  `UPLOAD_DIR` already point there.
- **Set `CLIENT_ORIGIN`** to your deployed frontend *and* each extension id,
  and set `CROSS_SITE=true` when the frontend is on another origin.

The extension needs no rebuild for a deployment — it reads whatever API the
Huddle page tells it, so pointing the frontend at the deployed server is
enough.

## What it does and does not do

- Play, pause and seek propagate both ways: the room drives the tab, and
  anything you do in the tab drives the room.
- Corrections are **seek-only**, with a 2s threshold. Netflix has no fine
  playback-rate control to absorb small drift into the way an uploaded file
  does, and every seek costs a rebuffer — so the bar for moving anybody is
  deliberately higher than the app's own player uses.
- `host_permissions` is `*://*/*`. The server URL is whatever a deployment
  says it is, so it cannot be listed ahead of time, and a content script has no
  way to raise a permission prompt — the alternative was an auto-configure that
  breaks on every host nobody predicted. Content scripts still only run on
  netflix.com and the Huddle app.
- It will break when Netflix reorganises their player internals. That is the
  standing cost of this approach, not a bug that gets fixed once.

## Tests

```bash
node extension/test/intent.test.mjs      # no server needed
node extension/test/twoclient.test.mjs   # needs the API running
```

`intent` covers the part that cannot be checked by reading it: whether a change
in the player was the person's doing or one of our own corrections. Getting it
wrong is a feedback loop that walks the whole room backwards. Two of these
failed when first written — see the note at the top of the file.

`twoclient` is the real scenario: two people, one room, both on Netflix. It
drives two sockets against a running server and checks that what one announces
and does reaches the other, and that the shared clock advances in real time.
Point it at a deployment with `HUDDLE_API=https://… node extension/test/twoclient.test.mjs`.
