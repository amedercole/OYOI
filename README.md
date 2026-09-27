# OYOI

Hackathon MVP: a small-restaurant owner texts a Twilio number, and an AI agent backed by **GBrain** memory manages ingredient inventory — emailing suppliers and ordering on supplier websites via Browser Use.

## Demo story

1. Dashboard shows mozzarella **low** (3 / 15 lbs). Click **Run check-in**. The owner gets: "Mozzarella is down to 3 lbs. Want me to order the usual 20 lbs from Company B (~$90)?" with **Yes** / **Change** buttons.
2. Tap **Change**. The agent asks what should be different.
3. Owner: `Make it 30 lbs, big weekend coming. Also tell Bob to push Pepsi to the 5th instead of the 15th`. The agent restates the revised plan, again with Yes / Change.
4. Owner approves however they like (`sounds good`, `yep go ahead`, a thumbs-up, or the Yes button). Bob gets an email, the browser agent checks out on Company B (`/supplier`), and inventory updates.
5. Because 30 lbs breaks from the mozzarella workflow, the agent asks: "Your usual is 20 lbs. Want 30 lbs to be the new normal?" with **Make it the default** / **Just this once**.
6. Either answer is recorded in GBrain. "Default" rewrites the workflow (see `/workflows`); "just this once" logs a one-off. Both show on `/brain` under "What I've learned about how Tony works".

Replies don't have to match the buttons: "nah not today" cancels, "make it 25 instead" edits in one step, "skip the email" drops a step. Real SMS can't render buttons, so texts get a short `(Yes / Change)` hint instead. Use **Reset demo** in the sidebar between rehearsals.

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
gbrain init --pglite --path ./brain --no-embedding --non-interactive --no-git --force
for f in brain-seed/**/*.md; do
  slug="${f#brain-seed/}"; slug="${slug%.md}"
  gbrain put "$slug" < "$f"
done

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
| `/api/checkin` | Morning check-in (also dashboard button) |
| `/api/actions` POST | Simulate inbound SMS from UI |

## Brain seed

Markdown in `brain-seed/` is the pristine starting state. On first run it's copied to `data/brain/` (the live copy the agent edits and syncs to GBrain), and **Reset demo** restores it.

- `company/tonys-pizzeria.md`
- `inventory/*.md`
- `appliances/*.md`
- `suppliers/company-b.md`, `contacts/bob-pepsi.md`
- `workflows/*.md` (usual quantities live in frontmatter, e.g. `default_qty`)
- `preferences/owner-behavior.md` (routine changes and one-offs learned from Tony's replies)
- `purchases/*.md` (prior online picks, e.g. pizza cutter for "same as last time")
- `actions/log.md`

Hello Hackathon.
