#!/usr/bin/env bash
# Reset demo state from the CLI (the dashboard's "Reset demo" link does the same without a restart).
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.bun/bin:$PATH"

rm -rf data
mkdir -p data

if command -v gbrain >/dev/null 2>&1; then
  shopt -s globstar
  for f in brain-seed/**/*.md; do
    slug="${f#brain-seed/}"
    gbrain put "${slug%.md}" --force < "$f" >/dev/null || true
  done
fi

echo "Demo reset. Restart npm run dev if the server is already running."
