#!/usr/bin/env bash
# Reset demo state from the CLI (the dashboard's "Reset demo" link does the same without a restart).
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.bun/bin:$PATH"

rm -rf data
mkdir -p data

if command -v gbrain >/dev/null 2>&1; then
  node scripts/seed-put.mjs >/dev/null || true
fi

echo "Demo reset. Restart npm run dev if the server is already running."
