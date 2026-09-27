---
id: reorder-mozzarella
trigger: mozzarella check-up (projected low or weekly order day)
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
**When** mozzarella is projected to hit its low point (5 lbs) or it's the usual weekly order day, whichever comes first,
**then** text Tony and offer to order the usual 20 lbs from Company B's website at $4.50/lb.
Steps: (1) text Tony the offer (2) wait for his go-ahead, changes, or a correction like "still have some" (3) place the order on Company B's site (4) log the delivery as a fresh count (5) log the action.
If Tony corrects the estimate, adjust the daily usage and reschedule the next check-up.
If Tony changes the order, ask whether the change should become the new routine.

## Timeline
- {{-12}}: Workflow enshrined after a weekend stockout
