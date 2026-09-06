#!/usr/bin/env bash
#
# Muse. — one command to run it all (macOS / Linux / WSL).
#
#   ./start.sh
#
# Installs anything missing, prepares the database on first run, starts the
# frontend + API together, and opens the app in your browser once it's up.
# Press Ctrl+C to stop everything.

set -uo pipefail
cd "$(dirname "$0")"

FRONTEND_URL="http://localhost:5173"
BOLD=$'\033[1m'; RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; DIM=$'\033[2m'; NC=$'\033[0m'

say()  { printf "${BOLD}▶ %s${NC}\n" "$1"; }
warn() { printf "${RED}!  %s${NC}\n" "$1"; }
ok()   { printf "${GREEN}✓ %s${NC}\n" "$1"; }

# --- prerequisites -----------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  warn "Node.js is not installed. Get it from https://nodejs.org (LTS), then run this again."
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  warn "npm is not installed (it ships with Node.js). Install Node.js and try again."
  exit 1
fi
say "Node $(node -v)"

# --- environment file --------------------------------------------------------
if [ ! -f server/.env ]; then
  if [ -f server/.env.example ]; then
    cp server/.env.example server/.env
    warn "Created server/.env from the example."
    warn "Open it and set DATABASE_URL (a free Postgres at https://neon.tech) before the app can sign you in."
  else
    warn "server/.env is missing and there's no example to copy. The API needs DATABASE_URL and JWT_SECRET."
  fi
elif grep -q "USER:PASSWORD@HOST" server/.env 2>/dev/null; then
  warn "server/.env still has the placeholder DATABASE_URL — set a real Postgres URL (https://neon.tech) or sign-in will fail."
fi

# --- dependencies ------------------------------------------------------------
FIRST_RUN=0
if [ ! -d node_modules ]; then
  say "Installing app dependencies (first run, this can take a minute)…"
  npm install || { warn "npm install failed."; exit 1; }
  FIRST_RUN=1
fi
if [ ! -d server/node_modules ]; then
  say "Installing server dependencies…"
  npm run server:install || { warn "server install failed."; exit 1; }
  FIRST_RUN=1
fi

# --- database / prisma -------------------------------------------------------
say "Generating the database client…"
npm --prefix server run generate >/dev/null 2>&1 || warn "prisma generate hit a snag (continuing)."

if [ "$FIRST_RUN" -eq 1 ] || [ ! -f .muse-setup-complete ]; then
  say "Syncing database tables…"
  if npm --prefix server run db:push; then
    touch .muse-setup-complete
    ok "Database ready."
  else
    warn "Could not sync the database. Check DATABASE_URL in server/.env, then run: npm --prefix server run db:push"
  fi
fi

# --- open the browser once the frontend answers ------------------------------
open_url() {
  if command -v open >/dev/null 2>&1; then open "$1"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$1"
  elif command -v powershell.exe >/dev/null 2>&1; then powershell.exe -c "Start-Process '$1'"
  fi
}
frontend_up() {
  if command -v curl >/dev/null 2>&1; then curl -sf -o /dev/null "$FRONTEND_URL"
  elif command -v wget >/dev/null 2>&1; then wget -q -O /dev/null "$FRONTEND_URL"
  else (exec 3<>/dev/tcp/127.0.0.1/5173) 2>/dev/null && exec 3>&- 3<&-
  fi
}
(
  for _ in $(seq 1 90); do
    if frontend_up; then
      printf "\n${GREEN}✓ Muse. is live → %s${NC}\n" "$FRONTEND_URL"
      open_url "$FRONTEND_URL"
      break
    fi
    sleep 1
  done
) &

# --- run both servers (foreground; Ctrl+C stops both) ------------------------
say "Starting Muse.  ${DIM}(frontend :5173 · API :4000 — Ctrl+C to stop)${NC}"
exec npm run dev:all
