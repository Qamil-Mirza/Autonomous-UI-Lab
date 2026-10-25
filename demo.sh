#!/usr/bin/env bash
# Runs the full GhostLoop product locally: SpacetimeDB, the worker (real adapters + Figma Make imports), the
# dashboard and the onboarding prototype. Services already running are reused; only what this script starts is
# stopped on Ctrl+C (the worker gets SIGINT so it removes its sandbox containers).
#
#   ./demo.sh                 start everything, open the dashboard, wait for Ctrl+C
#   ./demo.sh --e2e [trials]  also drive the import flow through the dashboard (spends model credits; default 6)
#   ./demo.sh --no-prototype  skip the onboarding prototype (imports don't need it)
#   ./demo.sh --no-open       don't open a browser
#
# Real runs use Bitdeer (simulated users) and Claude (analysis) from .env and cost money.
set -euo pipefail

cd "$(dirname "$0")"
ROOT="$(pwd)"
LOGS="$ROOT/.ghostloop/demo-logs"
FIXTURE="$ROOT/packages/importer/fixtures/northwind-make-export.zip"
DASHBOARD_URL="http://localhost:5174"
IMPORT_API="http://127.0.0.1:${GHOSTLOOP_IMPORT_PORT:-5180}"

E2E=0
TRIALS=6
PROTOTYPE=1
OPEN=1
while [ $# -gt 0 ]; do
  case "$1" in
    --e2e)
      E2E=1
      if [ "${2:-}" != "" ] && [ "${2#-}" = "$2" ]; then TRIALS="$2"; shift; fi
      ;;
    --no-prototype) PROTOTYPE=0 ;;
    --no-open) OPEN=0 ;;
    -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
  shift
done

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
warn() { printf '\033[33m  ! %s\033[0m\n' "$*"; }
fail() { printf '\033[31m  ✗ %s\033[0m\n' "$*" >&2; exit 1; }
ok()   { printf '\033[32m  ✓ %s\033[0m\n' "$*"; }

# ---------------------------------------------------------------- process management

set -m                       # each background job gets its own process group, so npm → tsx children stop together
STARTED_PIDS=()
STARTED_NAMES=()

cleanup() {
  trap - INT TERM EXIT
  [ ${#STARTED_PIDS[@]} -eq 0 ] && exit 0
  echo
  bold "Stopping what this script started"
  local i
  for (( i=${#STARTED_PIDS[@]}-1; i>=0; i-- )); do
    local pid="${STARTED_PIDS[$i]}" name="${STARTED_NAMES[$i]}"
    if kill -0 "$pid" 2>/dev/null; then
      kill -INT -- "-$pid" 2>/dev/null || kill -INT "$pid" 2>/dev/null || true
      # The worker needs a moment to remove its preview containers.
      for _ in $(seq 1 60); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
      kill -KILL -- "-$pid" 2>/dev/null || true
      info "stopped $name"
    fi
    # Backstop: if the worker could not finish its own cleanup, remove its sandbox containers here.
    if [ "$name" = worker ] && command -v docker >/dev/null; then
      local left
      left="$(docker ps -aq --filter label=ghostloop.managed=1 2>/dev/null || true)"
      if [ -n "$left" ]; then docker rm -f $left >/dev/null 2>&1 || true; info "removed leftover sandbox containers"; fi
    fi
  done
  exit 0
}
trap cleanup INT TERM EXIT

start() {   # start <name> <command...>  — runs in the background, logging to $LOGS/<name>.log
  local name="$1"; shift
  ( cd "$ROOT" && exec "$@" ) > "$LOGS/$name.log" 2>&1 &
  STARTED_PIDS+=("$!")
  STARTED_NAMES+=("$name")
  info "started $name (log: .ghostloop/demo-logs/$name.log)"
}

wait_for() {  # wait_for <name> <seconds> <command...> — polls until the command succeeds
  local name="$1" seconds="$2"; shift 2
  local i
  for (( i=0; i<seconds*2; i++ )); do
    if "$@" >/dev/null 2>&1; then ok "$name ready"; return 0; fi
    sleep 0.5
  done
  return 1
}

up() { curl -s -o /dev/null --max-time 2 "$1"; }

show_log() { echo; tail -n 25 "$LOGS/$1.log" | sed 's/^/    /'; echo; }

# ---------------------------------------------------------------- prerequisites

bold "Checking prerequisites"
command -v node >/dev/null || fail "Node.js 22+ is required (nvm use)."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 22 ] || fail "Node.js 22+ is required; found $(node -v) (try: nvm use)."
ok "node $(node -v)"
command -v spacetime >/dev/null || fail "SpacetimeDB CLI not found: curl -sSf https://install.spacetimedb.com | sh"
ok "spacetime CLI"
mkdir -p "$LOGS"
if [ ! -d node_modules ] || [ ! -e node_modules/@ghostloop/importer ]; then
  info "installing dependencies (npm install)…"
  npm install --no-audit --no-fund >"$ROOT/.ghostloop/npm-install.log" 2>&1 || fail "npm install failed; see .ghostloop/npm-install.log"
fi
ok "dependencies installed"

if docker info >/dev/null 2>&1; then
  ok "Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null) (imported apps build and preview here)"
else
  warn "Docker is not running: the dashboard will explain that imports need it. Start Docker Desktop to import apps."
fi

if [ -z "${SIMULATOR_BROWSER_CHANNEL:-}" ] && [ -d "/Applications/Google Chrome.app" ]; then
  export SIMULATOR_BROWSER_CHANNEL=chrome
fi
ok "browser: ${SIMULATOR_BROWSER_CHANNEL:-Playwright Chromium (npx playwright install chromium if missing)}"

for key in BITDEER_API_KEY ANTHROPIC_API_KEY; do
  if [ -z "${!key:-}" ] && ! grep -q "^$key=." .env 2>/dev/null; then
    warn "$key is not set in .env or the shell; real trials or analysis will fail as model errors."
  fi
done

# ---------------------------------------------------------------- services

bold "Starting services"

if up http://127.0.0.1:3000/v1/ping; then
  ok "SpacetimeDB already running on :3000"
else
  start spacetimedb spacetime start
  wait_for "SpacetimeDB" 30 up http://127.0.0.1:3000/v1/ping || { show_log spacetimedb; fail "SpacetimeDB did not start."; }
fi

# Publishing is idempotent and keeps data; a schema conflict needs `npm run stdb:publish:fresh` (deletes all data).
if spacetime publish --server local --module-path spacetimedb --yes ghostloop >"$LOGS/publish.log" 2>&1; then
  ok "database module published (data kept)"
else
  show_log publish
  fail "Publishing the database module failed. If the schema changed, reset with: npm run stdb:publish:fresh"
fi

if [ "$PROTOTYPE" = 1 ]; then
  if up http://localhost:5173/; then
    ok "onboarding prototype already running on :5173"
  else
    start prototype npm run dev -w @ghostloop/prototype
    wait_for "onboarding prototype" 60 up http://localhost:5173/ || { show_log prototype; fail "The prototype did not start."; }
  fi
fi

if up "$IMPORT_API/api/import-runtime"; then
  ok "worker already running (import API on $IMPORT_API)"
  warn "Reusing it. If it was started before your last code change, stop it and rerun this script."
else
  start worker npm run worker:real
  for _ in $(seq 1 120); do
    if up "$IMPORT_API/api/import-runtime"; then break; fi
    if grep -q "worker failed\|disconnected:" "$LOGS/worker.log" 2>/dev/null; then show_log worker; fail "The worker exited. NOT_WRITER: run npm run stdb:publish:fresh (deletes data)."; fi
    sleep 0.5
  done
  up "$IMPORT_API/api/import-runtime" || { show_log worker; fail "The worker did not start its import API."; }
  ok "worker ready (real adapters, imports on $IMPORT_API)"
fi

if up "$DASHBOARD_URL/"; then
  ok "dashboard already running on :5174"
else
  start dashboard npm run dev -w @ghostloop/dashboard
  wait_for "dashboard" 60 up "$DASHBOARD_URL/" || { show_log dashboard; fail "The dashboard did not start."; }
fi
up "$DASHBOARD_URL/api/import-runtime" || warn "The dashboard can't reach the import API; restart the dashboard so it picks up the proxy config."

npm run fixture:zip -w @ghostloop/importer >"$LOGS/fixture.log" 2>&1 && ok "fixture ZIP built" || warn "Could not build the fixture ZIP; see .ghostloop/demo-logs/fixture.log"

# ---------------------------------------------------------------- ready

echo
bold "GhostLoop is running"
info "Dashboard:   $DASHBOARD_URL   → Import app"
info "Import API:  $IMPORT_API"
[ "$PROTOTYPE" = 1 ] && info "Prototype:   http://localhost:5173/v/ver_baseline/signup   (onboarding tests: Tests → Start a new test)"
info "Fixture ZIP: $FIXTURE"
info "             (compatibility fixture, not a real Figma Make export)"
info "Logs:        .ghostloop/demo-logs/"
echo
info "Try it: upload the fixture → task \"Order one flat white for pickup and get the order confirmed.\""
info "        checks: shows text \"Order confirmed\" + reaches route /order/confirmed"
info "        test data: name=Pat Example / email=pat@example.com → Save → Check → Freeze → Start baseline"
echo

if [ "$OPEN" = 1 ] && [ "$E2E" = 0 ] && command -v open >/dev/null; then open "$DASHBOARD_URL" || true; fi

if [ "$E2E" = 1 ]; then
  SHOTS="$LOGS/e2e-$(date +%Y%m%d-%H%M%S)"
  bold "Driving the import flow through the dashboard ($TRIALS trials; spends model credits)"
  if npx tsx packages/importer/scripts/dashboard-e2e.ts "$FIXTURE" "$SHOTS" "$TRIALS"; then
    ok "walkthrough finished; screenshots in ${SHOTS#$ROOT/}"
  else
    warn "walkthrough ended early (see output above); screenshots in ${SHOTS#$ROOT/}"
  fi
  echo
fi

if [ ${#STARTED_PIDS[@]} -eq 0 ]; then
  info "Everything was already running; nothing to stop. Exiting."
  exit 0
fi
info "Press Ctrl+C to stop the services this script started."
while true; do
  for i in "${!STARTED_PIDS[@]}"; do
    if ! kill -0 "${STARTED_PIDS[$i]}" 2>/dev/null; then
      warn "${STARTED_NAMES[$i]} exited unexpectedly:"
      show_log "${STARTED_NAMES[$i]}"
      exit 1
    fi
  done
  sleep 2
done
