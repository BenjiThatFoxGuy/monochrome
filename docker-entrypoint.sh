#!/bin/sh
set -e

# Start the Subsonic API server in the background using the bundled Bun runtime.
SUBSONIC_PORT="${SUBSONIC_PORT:-4533}"
echo "[entrypoint] Starting Monochrome Subsonic API on port ${SUBSONIC_PORT}..."
/usr/local/bin/bun /app/server/index.js &
SUBSONIC_PID=$!

# Poll the Subsonic health endpoint until it responds (max 15 seconds).
TRIES=0
until wget --no-verbose --tries=1 --spider "http://127.0.0.1:${SUBSONIC_PORT}/health" 2>/dev/null || [ "$TRIES" -ge 15 ]; do
    TRIES=$((TRIES + 1))
    sleep 1
done

if [ "$TRIES" -ge 15 ]; then
    echo "[entrypoint] Warning: Subsonic API did not respond within 15 seconds; continuing anyway."
fi

# Trap signals so we can gracefully shut down both processes.
trap 'kill "$SUBSONIC_PID" 2>/dev/null; exit 0' INT TERM

echo "[entrypoint] Starting nginx..."
exec nginx -g "daemon off;"
