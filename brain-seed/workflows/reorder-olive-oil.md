---
id: reorder-olive-oil
trigger: olive oil check-up (projected low or biweekly order day)
action: order
channel: website
supplier: company-b
inventory: inventory/olive-oil
product: Olive Oil
sku: OIL-EVOO
default_qty: 6
unit: liters
unit_price: 9.5
---

# Workflow: Reorder Olive Oil from Company B

## Compiled Truth
**When** olive oil is projected to hit its low point (2 liters) or it's been two weeks since the last order, whichever comes first,
**then** text Tony and offer the usual 6 liters from Company B at $9.50/liter.

## Timeline
- {{-30}}: Workflow enshrined
