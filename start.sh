#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-3000}"
STATIC_DIR="$PROJECT_DIR/dist"
WORKER_DIR="${OPENCODE_WEB_DIR:-${RUNNER_TEMP:-/tmp}/omgithub-web}"

run_timed() {
  /usr/bin/time -p "$@"
}

cd "$PROJECT_DIR"
run_timed mkdir -p "$STATIC_DIR" "$WORKER_DIR"

# Projects with a package manifest install dependencies and build in place.
# This game is a self-contained static Three.js project whose built directory
# is dist/, so no package installation or compilation is needed.
if [[ -f "$PROJECT_DIR/package.json" ]]; then
  if [[ -f "$PROJECT_DIR/package-lock.json" ]]; then
    run_timed npm ci --prefix "$PROJECT_DIR"
  else
    run_timed npm install --prefix "$PROJECT_DIR"
  fi
  if node -e 'const p=require(process.argv[1]); process.exit(p.scripts?.build ? 0 : 1)' "$PROJECT_DIR/package.json"; then
    run_timed npm run --prefix "$PROJECT_DIR" build
  fi
fi

run_timed test -s "$STATIC_DIR/index.html"
run_timed test -s "$STATIC_DIR/vendor/three.module.js"
run_timed test -s "$STATIC_DIR/vendor/three.core.js"
run_timed python3 -c 'import json,os,sys; json.dump({"project":sys.argv[1],"directory":sys.argv[2]}, open(sys.argv[3],"w"), indent=2); print()' \
  "$PROJECT_DIR" "$STATIC_DIR" "$WORKER_DIR/deployment-output.json"

# Keep the server in the foreground for the controller-owned tmux lifecycle.
run_timed python3 -m http.server "$PORT" --directory "$STATIC_DIR"
