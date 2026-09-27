#!/usr/bin/env bash
# Reset demo state: mozzarella low, clean SMS/actions DB, fresh action log.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.bun/bin:$PATH"

cat > brain-seed/inventory/mozzarella.md <<'EOF'
---
name: Mozzarella
qty: 3
unit: lbs
par: 15
supplier: company-b
sku: MOZ-20
reorder_qty: 20
---

# Mozzarella

## Compiled Truth
Fresh whole-milk mozzarella for pizzas. Currently **LOW** (3 lbs vs par 15).
Supplier: Company B (website order). Standard reorder: 20 lbs ($4.50/lb = ~$90).
Workflow: when low, propose website order from Company B.

## Timeline
- 2026-09-27: Stock counted at 3 lbs during morning check
- 2026-09-20: Received 20 lbs from Company B
EOF

cat > brain-seed/actions/log.md <<'EOF'
# Actions Log

Completed agent actions are written here as dated entries so the brain remembers past orders, emails, and prices.
EOF

rm -f data/oyoi.sqlite data/oyoi.sqlite-*
rm -rf data/versions
mkdir -p data

if command -v gbrain >/dev/null 2>&1; then
  gbrain put inventory/mozzarella --force < brain-seed/inventory/mozzarella.md || true
  gbrain put actions/log --force < brain-seed/actions/log.md || true
fi

echo "Demo reset. Mozzarella is low at 3 lbs. Restart npm run dev if the server is already running."
