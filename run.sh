#!/usr/bin/env bash
# Start fulgurlab for development: API on :8080, editor on http://localhost:5173.
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

echo "▶ Editor: http://localhost:5173"
npm run dev:web
