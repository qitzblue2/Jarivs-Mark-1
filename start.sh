#!/bin/sh
# Double-click or run: ./start.sh      (add --dev, --lan, --rebuild, --no-open as needed)
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js isn't installed. Get the current LTS from https://nodejs.org and run this again."
  exit 1
fi
exec node scripts/launch.mjs "$@"
