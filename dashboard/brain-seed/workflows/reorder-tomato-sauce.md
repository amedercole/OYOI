---
id: reorder-tomato-sauce
trigger: tomato sauce check-up (projected low or weekly order day)
action: order
channel: website
supplier: company-b
inventory: inventory/tomato-sauce
product: Tomato Sauce
sku: SAUCE-#10
default_qty: 12
unit: cans
unit_price: 6.25
---

# Workflow: Reorder Tomato Sauce from Company B

## Compiled Truth
**When** tomato sauce is projected to hit its low point (4 cans) or it's the usual weekly order day, whichever comes first,
**then** text Tony and offer the usual 12 cans from Company B at $6.25/can.

## Timeline
- {{-30}}: Workflow enshrined
