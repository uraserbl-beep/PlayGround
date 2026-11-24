#!/usr/bin/env bash
set -uo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

: "${CAPTURE_URL:?Set CAPTURE_URL to the preview URL.}"
: "${CAPTURE_DIR:?Set CAPTURE_DIR to the capture output directory.}"
: "${RUNTIME_DIR:?Set RUNTIME_DIR to the runtime directory.}"

run_timed() {
  local label="$1"
  shift
  echo "[$label] starting"
  /usr/bin/time -p "$@"
  local status=$?
  echo "[$label] finished (exit $status)"
  return "$status"
}

run_timed "prepare capture directory" mkdir -p "$CAPTURE_DIR"
mkdir_status=$?
if [[ $mkdir_status -ne 0 ]]; then
  echo "Capture directory setup failed." >&2
  exit 1
fi

run_timed "capture desktop and mobile" env \
  CAPTURE_URL="$CAPTURE_URL" \
  CAPTURE_DIR="$CAPTURE_DIR" \
  node "$RUNTIME_DIR/scripts/default-capture.mjs"
capture_status=$?

if [[ $capture_status -eq 75 ]]; then
  echo "Temporary navigation/browser infrastructure failure (exit 75)." >&2
elif [[ $capture_status -ne 0 ]]; then
  echo "Capture script or rendering defect (exit 1)." >&2
  capture_status=1
fi
exit "$capture_status"
