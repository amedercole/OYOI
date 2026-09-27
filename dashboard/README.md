# OYOI

Hackathon MVP: a small-restaurant owner texts a Twilio number, and an AI agent backed by **GBrain** memory manages ingredient inventory — emailing suppliers and ordering on supplier websites via Browser Use.

## Estimated inventory and check-ups

Small restaurants don't have scales or POS-linked stock, so nothing here is a live count. Each inventory page in GBrain stores the last count, an estimated daily usage, a low point, and the usual order cadence. The agent projects what's on hand and schedules a check-up for the **earlier** of "projected to hit the low point" and "usual order day". A daily 8am cron texts Tony about anything due, at most once per item per day.

Check-ups offer the reorder straight away, with **Yes** / **Change** / **Still have some** buttons. Tony's corrections tune the estimates automatically, and the agent says so in one line:

- **Still have some** (or "we're good" / "not yet"): eases the usage estimate by 15% and checks back in 2 days.
- **A count** (e.g. "about 4 lbs left"): logs a real count and blends the usage it implies 50/50 with the old estimate. If the count is still under the low point, the offer stands.
- **Ran out**: logs 0, bumps usage up, and re-offers the order.
- **Unprompted counts** also work, e.g. "we've got 10 lbs of mozz left".
- **An order** logs the delivery as a fresh count and resets the usual-order-day clock.

Every correction lands on the item's GBrain timeline and in the behavior log on `/brain`.

**Demo clock:** the phone mirror has **Fast-forward a day**, which advances a demo date and fires any check-ups that come due. **Reset demo** rewinds it. Seed dates are relative (`{{-4}}` = 4 days before the demo starts), so the story works any day.

## Demo story

1. Reset the demo. Inventory shows mozzarella at ~8 lbs, with its next check-up **tomorrow** (projected low). Click **Fast-forward a day**. The owner gets: "Morning Tony! Mozzarella's probably low (~5 lbs by my math). Want me to order the usual 20 lbs of mozzarella from Company B (~$90)?" with **Yes** / **Change** / **Still have some**.
   - Optional detour: tap **Still have some**. The agent says "I'll ease my mozzarella estimate to ~2.6 lbs/day and check back Wednesday." Fast-forward twice and it checks back. Reply "about 4 lbs left" to see it recalibrate from a real count.
2. Tap **Change**. The agent asks what should be different.
3. Owner: `Make it 30 lbs, big weekend coming. Also tell Bob to push Pepsi to the 5th instead of the 15th`. The agent restates the revised plan, again with Yes / Change.
4. Owner approves however they like (`sounds good`, `yep go ahead`, a thumbs-up, or the Yes button). Bob gets an email, the browser agent checks out on Company B (`/supplier`), and inventory updates.
5. Because 30 lbs breaks from the mozzarella workflow, the agent asks: "Your usual is 20 lbs. Want 30 lbs to be the new normal?" with **Make it the default** / **Just this once**.
6. Either answer is recorded in GBrain. "Default" rewrites the workflow (see `/workflows`); "just this once" logs a one-off. Both show on `/brain` under "What I've learned about how Tony works".

Replies don't have to match the buttons: "nah not today" cancels, "make it 25 instead" edits in one step, "skip the email" drops a step. Real SMS can't render buttons, so texts get a short `(Yes / Change)` hint instead. Use **Reset demo** in the sidebar between rehearsals.

Keep fast-forwarding and more check-ups arrive. On day 5, tomato sauce hits its usual order day. On day 6, flour and olive oil come due together and are offered as one Company B order ("skip the oil and make it 60 lbs of flour" works). `python3 scripts/rehearse-checkups.py` replays the whole week against a running dev server.

### Text-to-shop (spatula)

1. Owner: `I want to order a spatula`. Agent: "Looking up spatulas for you…"
2. Product cards appear with **Yes-style product buttons** (name + price) plus **Show more**. Tap one, or reply `2` / `the cheap one` / `metal ones instead`.
3. Agent adds the pick to a real retailer cart via Browser Use (stops before payment). Watch the live view on `/actions`.
4. "Added to your Target cart. Finish checkout here: \<link\>". GBrain records the purchase under `purchases/spatula`.
5. Later, `order a pizza cutter` demos memory: "Same as last time? OXO …" with **Same as last time** / **Show me options** (seeded prior purchase).

Without `SERPER_API_KEY`, shopping uses a curated demo catalog. Without `BROWSER_USE_API_KEY`, add-to-cart is mocked and the product link is returned. Real retailer sites can show captchas or login walls — rehearse the items you plan to demo.

## Stack

- Next.js (App Router) dashboard + API
- Twilio SMS (inbound webhook + outbound REST)
- GBrain (`garrytan/gbrain`) for company context, inventory pages, workflows, memory
- SQLite for SMS log + action runs
- Resend / Gmail for email
- Serper Google Shopping (optional) + curated fallback catalog
- Browser Use Cloud (optional) for virtual-browser cart adds and mock `/supplier` checkout

**Must run as a long-lived Node process** (`npm run dev`), not Vercel serverless. Expose with ngrok or cloudflared so Twilio can reach `/api/twilio/inbound`.

## Setup

```bash
# 1. Install deps
npm install

# 2. Install GBrain (never npm install gbrain — unrelated package)
curl -fsSL https://bun.sh/install | bash
bun install -g github:garrytan/gbrain#latest-stable

# 3. Init brain + import seed
npm run brain:init
npm run brain:import   # resolves relative {{-N}} seed dates, then gbrain put for each page

# 4. Env
cp .env.local.example .env.local
# fill Twilio + optional LLM / email / Browser Use keys

# 5. Run
npm run dev

# 6. Tunnel (separate terminal)
ngrok http 3000
# set PUBLIC_BASE_URL to the https URL
# Twilio number webhook → POST {PUBLIC_BASE_URL}/api/twilio/inbound
```

Without Twilio keys, use the **phone mirror** on the right of the dashboard to simulate owner SMS end-to-end.

## Key routes

| Path | Purpose |
|------|---------|
| `/` | Inventory + appliances |
| `/workflows` | Enshrined actions |
| `/actions` | Live / finished action runs |
| `/brain` | Memory pages + diffs |
| `/supplier` | Mock Company B storefront |
| `/api/twilio/inbound` | Twilio SMS webhook |
| `/api/checkin` | Run today's due check-ups (also the **Run check-in** button) |
| `/api/demo/advance` POST | Demo clock +1 day, then run due check-ups (**Fast-forward a day**) |
| `/api/actions` POST | Simulate inbound SMS from UI |

## Brain seed

Markdown in `brain-seed/` is the pristine starting state. On first run it's copied to `data/brain/` (the live copy the agent edits and syncs to GBrain), and **Reset demo** restores it.

- `company/tonys-pizzeria.md`
- `inventory/*.md` (`last_count`, `last_counted`, `daily_use`, `par` = low point, `order_every_days`, `last_ordered`)
- `appliances/*.md`
- `suppliers/company-b.md`, `contacts/bob-pepsi.md`
- `workflows/*.md` (usual quantities live in frontmatter, e.g. `default_qty`)
- `preferences/owner-behavior.md` (routine changes and one-offs learned from Tony's replies)
- `purchases/*.md` (prior online picks, e.g. pizza cutter for "same as last time")
- `actions/log.md`

Hello Hackathon.
