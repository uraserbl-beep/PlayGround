#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-3000}"
DEPLOYMENT_DIR="/home/runner/work/_temp/omgithub-web"

cd "$PROJECT_DIR"
/usr/bin/time -p mkdir -p "$PROJECT_DIR/dist" "$DEPLOYMENT_DIR"

# This project is a static Three.js page loaded from a CDN. It has no local
# package manifest, install step, or compile step; dist/index.html is its build.
/usr/bin/time -p test -s "$PROJECT_DIR/dist/index.html"
/usr/bin/time -p python3 -c 'import json,sys; json.dump({"project":sys.argv[1],"directory":sys.argv[2]}, open(sys.argv[3],"w"), indent=2); print()' \
  "$PROJECT_DIR" "$PROJECT_DIR/dist" "$DEPLOYMENT_DIR/deployment-output.json"

# Keep the server in the foreground for the controller's tmux lifecycle.
exec /usr/bin/time -p python3 -m http.server "$PORT" --directory "$PROJECT_DIR/dist"
