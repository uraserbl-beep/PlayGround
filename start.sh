#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

PORT="${PORT:-3000}"
export PORT

: "${OPENCODE_WEB_DIR:=/home/runner/work/_temp/omgithub-web}"
mkdir -p "$OPENCODE_WEB_DIR"

BUILT_DIR="$PROJECT_DIR/dist"

run_timed() {
  local label="$1"
  shift
  echo "[$label] starting"
  set +e
  /usr/bin/time -p "$@"
  local status=$?
  set -e
  echo "[$label] finished (exit $status)"
  return "$status"
}

run_timed "install dependencies" bash -c 'if [[ -f package.json ]] && [[ -f package-lock.json ]]; then npm ci; elif [[ -f package.json ]]; then npm install --no-audit --no-fund; fi'

run_timed "build static app" bash -c 'mkdir -p dist; cp -f index.html dist/index.html; cp -f game.html dist/game.html'

mkdir -p "$BUILT_DIR"
export PROJECT_DIR OPENCODE_WEB_DIR BUILT_DIR
run_timed "write deployment metadata" node -e 'const fs=require("fs"); const meta={project:process.env.PROJECT_DIR,directory:process.env.BUILT_DIR}; fs.mkdirSync(process.env.OPENCODE_WEB_DIR,{recursive:true}); fs.writeFileSync(process.env.OPENCODE_WEB_DIR+"/deployment-output.json",JSON.stringify(meta));'

run_timed "serve app" node server.js
