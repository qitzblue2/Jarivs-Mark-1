#!/bin/sh
# Restart the mock provider on :8899, tracking its pid.
# Fails loudly, with the log, if it didn't come up — a mock that died at
# startup otherwise looks identical to one that is running.
D="$(dirname "$0")"
[ -f "$D/.mock.pid" ] && kill "$(cat "$D/.mock.pid")" 2>/dev/null && sleep 1
node "$D/mock-provider.mjs" > "$D/.mock.log" 2>&1 &
echo $! > "$D/.mock.pid"
sleep 1
if ! kill -0 "$(cat "$D/.mock.pid")" 2>/dev/null; then
  echo "mock provider failed to start:" >&2
  cat "$D/.mock.log" >&2
  exit 1
fi
echo "mock pid=$(cat "$D/.mock.pid")"
