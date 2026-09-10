#!/bin/sh
# Restart the mock provider on :8899, tracking its pid.
D="$(dirname "$0")"
[ -f "$D/.mock.pid" ] && kill "$(cat "$D/.mock.pid")" 2>/dev/null && sleep 1
node "$D/mock-provider.mjs" > "$D/.mock.log" 2>&1 &
echo $! > "$D/.mock.pid"
sleep 1
echo "mock pid=$(cat "$D/.mock.pid")"
