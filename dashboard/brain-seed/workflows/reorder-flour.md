---
id: reorder-flour
trigger: flour check-up (projected low or biweekly order day)
action: order
channel: website
supplier: company-b
inventory: inventory/flour
product: Flour
sku: FLOUR-50
default_qty: 50
unit: lbs
unit_price: 0.85
---

# Workflow: Reorder Flour from Company B

## Compiled Truth
**When** flour is projected to hit its low point (15 lbs) or it's been two weeks since the last bag, whichever comes first,
**then** text Tony and offer the usual 50 lb bag from Company B at $0.85/lb.

## Timeline
- {{-30}}: Workflow enshrined
