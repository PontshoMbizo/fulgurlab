#!/usr/bin/env bash
# Start fulgurlab for development: API on :8080, editor on http://localhost:5173
# (or the next free port if 5173 is taken; set FULGUR_WEB_PORT to choose one).
# Uses local Scilab if installed, otherwise builds and runs the server in a container
# (podman or docker). Ctrl+C stops everything.
set -euo pipefail
cd "$(dirname "$0")"

PIDS=()
CONTAINER=""
cleanup() {
  trap - EXIT INT TERM
  for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null || true; done
  [ -n "$CONTAINER" ] && "$ENGINE" stop "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

[ -d web/node_modules ] || npm --prefix web install
[ -d server/node_modules ] || npm --prefix server install

if command -v scilab-cli >/dev/null 2>&1; then
  echo "▶ Scilab found locally, starting API on :8080"
  npm run dev:server &
  PIDS+=($!)
else
  ENGINE=$(command -v podman || command -v docker || true)
  [ -n "$ENGINE" ] || { echo "Need local Scilab, podman or docker." >&2; exit 1; }
  echo "▶ No local Scilab, running API in a container ($ENGINE) on :8080"
  if [ "$(basename "$ENGINE")" = podman ]; then
    "$ENGINE" build --format docker -t fulgurlab .
  else
    "$ENGINE" build -t fulgurlab .
  fi
  CONTAINER=fulgurlab-api
  "$ENGINE" rm -f "$CONTAINER" >/dev/null 2>&1 || true
  "$ENGINE" run --rm --name "$CONTAINER" -p 8080:8080 --read-only --tmpfs /tmp \
    --tmpfs /home/fulgur --cap-drop=ALL --security-opt no-new-privileges \
    --pids-limit 256 --memory 2g fulgurlab &
  PIDS+=($!)
fi

# Vite would pick another port silently if this one is busy, so choose a free one here and say which.
# (ss sees listeners on ::1 as well as 127.0.0.1; fall back to a connect test where ss is missing)
port_free() {
  if command -v ss >/dev/null 2>&1; then ! ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]$1\$"
  else ! (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; fi
}
WEB_PORT=${FULGUR_WEB_PORT:-5173}
until port_free "$WEB_PORT"; do WEB_PORT=$((WEB_PORT + 1)); done
export FULGUR_WEB_PORT=$WEB_PORT FULGUR_API=http://127.0.0.1:8080
echo "▶ Editor: http://localhost:$WEB_PORT"
npm run dev:web
