# OYOI — Ops You Only Inbox

Hackathon MVP: a small-restaurant owner texts a Twilio number, and an AI agent backed by **GBrain** memory manages ingredient inventory — emailing suppliers and ordering on supplier websites via Browser Use.

## Demo story

1. Dashboard shows mozzarella **low** (3 / 15 lbs). Click **Run check-in** → owner phone buzzes.
2. Owner texts: `Yes order cheese, and tell Bob the Pepsi guy to deliver on the 5th instead of the 15th.`
3. Agent recalls workflows from GBrain and replies with a plan + cost. Reply `YES`.
4. Bob gets an email; browser agent checks out on Company B (`/supplier`); inventory updates; actions show as done.
5. Owner texts: `Remember we switched to oat milk.` → **Brain** page shows the diff.

## Stack

- Next.js (App Router) dashboard + API
- Twilio SMS (inbound webhook + outbound REST)
- GBrain (`garrytan/gbrain`) for company context, inventory pages, workflows, memory
- SQLite for SMS log + action runs
- Resend / Gmail for email
- Browser Use Cloud (optional) against mock `/supplier` storefront

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

Markdown in `brain-seed/` is the human-readable source of truth (also imported into GBrain):

- `company/tonys-pizzeria.md`
- `inventory/*.md`
- `appliances/*.md`
- `suppliers/company-b.md`, `contacts/bob-pepsi.md`
- `workflows/*.md`
- `actions/log.md`

Hello Hackathon.
