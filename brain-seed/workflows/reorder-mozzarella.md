---
id: reorder-mozzarella
trigger: mozzarella qty below par
action: order
channel: website
supplier: company-b
---

# Workflow: Reorder Mozzarella from Company B

## Compiled Truth
**When** mozzarella inventory falls below par (15 lbs),
**Then** propose ordering `reorder_qty` (20 lbs) from Company B's website.
Estimated cost ~$90 (under $200 auto-confirm threshold once owner says yes).
Steps: (1) propose action with cost (2) wait for YES (3) run browser order on `/supplier` (4) update inventory qty (5) log action.

## Timeline
- 2026-09-15: Workflow enshrined after weekend stockout
