---
name: restaurant-inventory
description: Load when a restaurant owner or cook reports stock, asks what to order, sets up ingredient tracking, or asks for a stock check-up by text.
---
# Restaurant Inventory

## Counts

- Record every number the owner texts with `inventory_update` in the same turn. Keep their unit; if
  they switch units ("2 cases" for an item tracked in lb), ask how many lb a case is before
  recording.
- A vague count ("about half a case", "running low") is recorded only after one short question
  that gets a number. Never invent or estimate a count.
- When folding a stock reply into the usage estimate, set `observation`:
  - `count` with `on_hand` for a real number
  - `some` when they still have some (no `on_hand`)
  - `out` when they ran out
- After recording, answer with what is now LOW and the quantity to order. Nothing low: say so in
  one line.

## First setup

Ask for the ingredients that hurt most when they run out, then per item: unit, par, reorder point,
supplier, estimated daily use, and usual order cadence (`order_every_days`, `last_ordered`).
Record them as they come; do not wait for the full list.

## Check-ups

Projected stock and the next check-up date live on each item. A background job texts the owner on
WhatsApp/SMS when items are due, or when `inventory_checkup_now` queues one. On a check-up turn:

- Bundle due items into one message
- Offer choices Yes / Change / Still have some
- On reply, record each observation with `inventory_update` and confirm any order before placing it

Do not create separate `scheduled_task` objects for inventory check-ups; the inventory job owns that.

## Ordering on Amazon

The browser carries the owner's saved Amazon sign-in. Build the cart from `inventory_report`
(`low_only`) and send one `browser_task` starting at `https://www.amazon.com`: search each item, add
the right pack size, open the cart, and stop before "Place your order". Text the owner the cart:
items, quantities, delivery date, total. Place the order only in a new `browser_task` after they
confirm that exact cart. A sign-in page means the saved sign-in expired: tell them to sign in to
Amazon in their own browser and re-sync their Browser Use profile.
