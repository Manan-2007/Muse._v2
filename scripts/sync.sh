#!/usr/bin/env bash
#
# sync - start the backend + ngrok tunnel in one command.
#
# Usage:
#   npm run sync
#   ./scripts/sync.sh
#
# Takes the port and the tunnel back by force before starting, then refuses to
# claim success until it has actually fetched something through the public URL.
# The version this replaced did neither, which produced the two failures worth
# naming here:
#
#   * A previous run still holding :4000 made the new server exit with
#     EADDRINUSE, while the script carried on and printed a working banner.
#   * ngrok's agent can lose its session to the relay and never get it back —
#     the process is still running, so nothing local looks wrong, but the
#     public URL answers ERR_NGROK_3200 and the deployed site reports the
#     backend as down.
#
# Both are invisible from inside the script unless it goes and checks, so it
# checks.

set -uo pipefail

PORT=4000
NGROK_DOMAIN="letter-fiction-fog.ngrok-free.dev"
NGROK_LOG=/tmp/ngrok-sync.log
# ngrok's own local dashboard, which is how we ask whether the tunnel is really
# up rather than merely launched.
NGROK_API="http://127.0.0.1:4040/api/tunnels"

# $0 is the symlink (~/.local/bin/sync) when run as a bare global command —
# resolve it to the real script before walking up to the project root, or
# ROOT ends up pointing at ~/.local instead of the repo.
SELF="$0"
while [ -L "$SELF" ]; do
  LINK="$(readlink "$SELF")"
  case "$LINK" in
    /*) SELF="$LINK" ;;
    *) SELF="$(dirname "$SELF")/$LINK" ;;
  esac
done
ROOT="$(cd "$(dirname "$SELF")/.." && pwd)"

CLEANED=0
cleanup() {
  [ "$CLEANED" = 1 ] && return
  CLEANED=1
  trap - EXIT INT TERM
  echo ""
  echo "Shutting down..."
  # Our own ngrok, then the whole process group for the server and its children.
  pkill -f "ngrok http $PORT" 2>/dev/null
  kill 0 2>/dev/null
  wait 2>/dev/null
}
trap cleanup EXIT INT TERM

# ── Take the port back ────────────────────────────────────────────────────────
# Anything already listening on it is a previous run that did not shut down —
# a crashed terminal, a backgrounded process, a stale watcher. Left alone it
# does not yield the port, it just makes the new server die on startup.
free_port() {
  local pids
  pids="$(lsof -ti "tcp:$PORT" 2>/dev/null)"
  [ -z "$pids" ] && return 0

  echo "Port $PORT is busy — stopping $(echo "$pids" | wc -l | tr -d ' ') process(es)..."
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null
  # Give them a moment to close listeners before escalating.
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    sleep 0.3
    [ -z "$(lsof -ti "tcp:$PORT" 2>/dev/null)" ] && return 0
  done

  pids="$(lsof -ti "tcp:$PORT" 2>/dev/null)"
  if [ -n "$pids" ]; then
    echo "Still holding on — forcing."
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null
    sleep 0.5
  fi
}

# Old agents keep the static domain claimed, so a new one is refused it.
free_ngrok() {
  if pgrep -f "ngrok http" >/dev/null 2>&1; then
    echo "Stopping an existing ngrok agent..."
    pkill -f "ngrok http" 2>/dev/null
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      sleep 0.3
      pgrep -f "ngrok http" >/dev/null 2>&1 || break
    done
    pkill -9 -f "ngrok http" 2>/dev/null
  fi
}

# A watcher stuck this early has nothing bound yet, so `free_port` cannot see
# it — this is what let one sit there silently starving every later `tsx`
# invocation of whatever it was contending over, with the backend hanging on
# startup printing nothing at all. Matched on the absolute path into *this*
# project's `node_modules`, not a bare "tsx watch", so it can never reach into
# an unrelated project running the same command elsewhere on the machine.
free_stale_watchers() {
  local pattern="$ROOT/server/node_modules/.bin/tsx watch src/server.ts"
  local pids
  pids="$(pgrep -f "$pattern" 2>/dev/null)"
  [ -z "$pids" ] && return 0

  echo "Clearing $(echo "$pids" | wc -l | tr -d ' ') stale backend watcher(s) from earlier runs..."
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    sleep 0.3
    pgrep -f "$pattern" >/dev/null 2>&1 || return 0
  done
  pids="$(pgrep -f "$pattern" 2>/dev/null)"
  # shellcheck disable=SC2086
  [ -n "$pids" ] && kill -9 $pids 2>/dev/null
}

# One line, unconditionally, before any of the three checks below. Each of
# them is silent when it finds nothing to do — which is the common case — but
# when it *does* find a previous session still up, killing it and waiting for
# the port or the tunnel to actually let go can run to several seconds with
# nothing printed at all. That silence reads exactly like a hang, and is what
# made a run that was genuinely working look like it wasn't.
echo "Checking for anything already running..."
free_stale_watchers
free_port
free_ngrok

# ── Backend ───────────────────────────────────────────────────────────────────
echo "Starting backend on port $PORT..."
npm --prefix "$ROOT/server" run dev &

# Polled, not slept. How long the server takes to boot depends on the machine,
# and a fixed wait is either too short on a cold start or wasted every time.
echo -n "Waiting for the backend"
BACKEND_UP=0
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null --max-time 2 "http://localhost:$PORT/api/health" 2>/dev/null; then
    BACKEND_UP=1
    break
  fi
  echo -n "."
  sleep 0.5
done
echo ""

if [ "$BACKEND_UP" != 1 ]; then
  echo ""
  echo "  The backend never came up on :$PORT."
  echo "  Its output is above — the usual causes are a bad .env or a failed"
  echo "  prisma migration, both of which print a reason."
  exit 1
fi
echo "Backend is up."

# ── Tunnel ────────────────────────────────────────────────────────────────────
echo "Opening the tunnel on $NGROK_DOMAIN..."
ngrok http "$PORT" --url="$NGROK_DOMAIN" --log=stdout > "$NGROK_LOG" 2>&1 &

# First: has the agent established a session at all? Its local API knows before
# the public URL does, and its error messages are far better than a timeout.
echo -n "Waiting for the tunnel"
TUNNEL_UP=0
for _ in $(seq 1 40); do
  if curl -fsS --max-time 2 "$NGROK_API" 2>/dev/null | grep -q "$NGROK_DOMAIN"; then
    TUNNEL_UP=1
    break
  fi
  echo -n "."
  sleep 0.5
done
echo ""

if [ "$TUNNEL_UP" != 1 ]; then
  echo ""
  echo "  ngrok never registered the tunnel. From its log:"
  grep -iE "err|error|fail" "$NGROK_LOG" 2>/dev/null | tail -5 | sed 's/^/    /'
  echo ""
  echo "  A domain already claimed by another agent, or no authtoken, are the"
  echo "  two that account for nearly all of these."
  exit 1
fi

# Then: does the public URL actually reach this machine? This is the check that
# catches the failure the old script could not see — agent alive, session dead.
echo -n "Checking the public URL"
PUBLIC_OK=0
for _ in $(seq 1 20); do
  CODE="$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 5 \
    -H 'ngrok-skip-browser-warning: true' \
    "https://$NGROK_DOMAIN/api/health" 2>/dev/null)"
  if [ "$CODE" = "200" ]; then
    PUBLIC_OK=1
    break
  fi
  echo -n "."
  sleep 1
done
echo ""

if [ "$PUBLIC_OK" != 1 ]; then
  echo ""
  echo "  The tunnel is registered but the public URL is not serving."
  echo "  https://$NGROK_DOMAIN/api/health did not answer 200."
  echo "  From its log:"
  grep -iE "err|error|fail" "$NGROK_LOG" 2>/dev/null | tail -5 | sed 's/^/    /'
  exit 1
fi

echo ""
echo "======================================================"
echo "  Backend:  http://localhost:$PORT          [ok]"
echo "  Tunnel:   https://$NGROK_DOMAIN  [ok]"
echo ""
echo "  Set in Vercel Environment Variables:"
echo "    VITE_API_URL = https://$NGROK_DOMAIN"
echo ""
echo "  ngrok log: $NGROK_LOG"
echo "======================================================"
echo ""
echo "Press Ctrl-C to stop both."
echo ""

wait
