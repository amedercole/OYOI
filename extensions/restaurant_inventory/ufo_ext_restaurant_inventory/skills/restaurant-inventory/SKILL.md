---
name: restaurant-inventory
description: Load when a restaurant owner or cook reports stock, asks what to order, sets up ingredient tracking, or asks for recurring count or reorder reminders by text.
---
# Restaurant Inventory

## Counts

- Record every number the owner texts with `inventory_update` in the same turn. Keep their unit; if
  they switch units ("2 cases" for an item tracked in lb), ask how many lb a case is before
  recording.
- A vague count ("about half a case", "running low") is recorded only after one short question
  that gets a number. Never invent or estimate a count.
- After recording, answer with what is now LOW and the quantity to order. Nothing low: say so in
  one line.

## First setup

Ask for the ten ingredients that hurt most when they run out, then per item: unit, par, and
supplier. Record them as they come; do not wait for the full list.

## Proactive texts

Offer these once tracking has items, and create only the ones the owner accepts, as recurring
`scheduled_task` objects applied from their SMS conversation so each run texts them:

| Task | Default | Prompt |
|---|---|---|
| Closing count | daily, 30 min after close | Ask for today's counts of the tracked items, grouped by where they are stored. |
| Reorder check | daily, 2 h before the earliest supplier cutoff | Run `inventory_report` with `low_only`; text the order list per supplier, or stay silent when nothing is low. |
| Weekly review | Monday morning | List items never counted or counted over 3 days ago, and ask whether to adjust any par. |

Convert the owner's local times to UTC cron. Ask their close time and supplier cutoffs if unknown.

## Ordering on Amazon

The browser carries the owner's saved Amazon sign-in. Build the cart from `inventory_report`
(`low_only`) and send one `browser_task` starting at `https://www.amazon.com`: search each item, add
the right pack size, open the cart, and stop before "Place your order". Text the owner the cart:
items, quantities, delivery date, total. Place the order only in a new `browser_task` after they
confirm that exact cart. A sign-in page means the saved sign-in expired: tell them to sign in to
Amazon in their own browser and re-sync their Browser Use profile.
