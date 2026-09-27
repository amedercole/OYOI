---
id: reorder-mozzarella
trigger: mozzarella below par
action: order
channel: website
supplier: company-b
inventory: inventory/mozzarella
product: Mozzarella
sku: MOZ-20
default_qty: 20
unit: lbs
unit_price: 4.5
---

# Workflow: Reorder Mozzarella from Company B

## Compiled Truth
**When** mozzarella falls below par (15 lbs),
**then** offer to order the usual 20 lbs from Company B's website at $4.50/lb.
Steps: (1) text Tony the offer (2) wait for his go-ahead or changes (3) place the order on Company B's site (4) add the delivery to inventory (5) log the action.
If Tony changes the order, ask whether the change should become the new routine.

## Timeline
- 2026-09-15: Workflow enshrined after a weekend stockout
