#!/bin/bash
# Redeploy fulgurlab from origin/scilab-sim (the default branch) on the self-host VM.
# Same shape as fpgasim's and mcusim's deploy.sh: pull, rebuild the one image
# (editor + headless Scilab), restart, health-check. nginx serves it as
# lab.pontsho-mbizo.co.za -> 127.0.0.1:8080 (compose.yml binds loopback only).
#
# Host-only settings live in compose.override.yml next to this file (untracked, so
# `git reset --hard` keeps it); on the 1-CPU VM it sets `cpus: 1`, because Docker
# refuses a CPU limit above the host's core count.
set -euo pipefail
cd ~/apps/fulgurlab

echo "== fetching origin/scilab-sim =="
git fetch origin scilab-sim
git reset --hard origin/scilab-sim

echo "== building + starting app =="
docker compose build
docker compose up -d

echo "== health check =="
ok=""
for i in $(seq 1 20); do
  if curl -sf http://127.0.0.1:8080/api/health >/dev/null; then
    ok=1
    break
  fi
  sleep 3
done

if [ -z "$ok" ]; then
  echo "fulgurlab deploy: FAILED health check" >&2
  docker compose logs --tail 40 fulgurlab >&2
  exit 1
fi

echo "fulgurlab deploy: OK"
