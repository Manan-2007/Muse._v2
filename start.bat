@echo off
REM  Muse. - one command to run it all (Windows).
REM
REM    start.bat   (double-click, or run from a terminal)
REM
REM  Installs anything missing, prepares the database on first run, starts the
REM  frontend + API together, and opens the app in your browser once it's up.
REM  Close this window to stop everything.

setlocal enabledelayedexpansion
cd /d "%~dp0"
set "FRONTEND_URL=http://localhost:5173"

where node >nul 2>nul || (echo(!  Node.js is not installed. Get it from https://nodejs.org ^(LTS^), then run this again.& pause& exit /b 1)
for /f "delims=" %%v in ('node -v') do echo(^> Node %%v

if not exist "server\.env" (
  if exist "server\.env.example" (
    copy /y "server\.env.example" "server\.env" >nul
    echo(!  Created server\.env from the example. Set DATABASE_URL ^(free at https://neon.tech^) before sign-in works.
  ) else (
    echo(!  server\.env is missing. The API needs DATABASE_URL and JWT_SECRET.
  )
)

set "FIRST_RUN=0"
if not exist "node_modules" (
  echo(^> Installing app dependencies ^(first run, this can take a minute^)...
  call npm install || (echo(!  npm install failed.& pause& exit /b 1)
  set "FIRST_RUN=1"
)
if not exist "server\node_modules" (
  echo(^> Installing server dependencies...
  call npm run server:install || (echo(!  server install failed.& pause& exit /b 1)
  set "FIRST_RUN=1"
)

echo(^> Generating the database client...
call npm --prefix server run generate >nul 2>nul

set "DO_DB=0"
if "!FIRST_RUN!"=="1" set "DO_DB=1"
if not exist ".muse-setup-complete" set "DO_DB=1"
if "!DO_DB!"=="1" (
  echo(^> Syncing database tables...
  call npm --prefix server run db:push && (echo done> ".muse-setup-complete") || (echo(!  Could not sync the database. Check DATABASE_URL in server\.env, then run: npm --prefix server run db:push)
)

echo(^> Opening %FRONTEND_URL% once it's ready...
start "" /min powershell -NoProfile -Command "for($i=0;$i -lt 90;$i++){try{$c=New-Object Net.Sockets.TcpClient;$c.Connect('127.0.0.1',5173);$c.Close();Start-Sleep 1;Start-Process 'http://localhost:5173';break}catch{Start-Sleep 1}}"

echo(^> Starting Muse.  (frontend :5173, API :4000 - close this window to stop)
call npm run dev:all
