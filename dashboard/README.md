# OYI dashboard

Thin Next.js front end over a local `ufoctl serve` running the `restaurant` pack. ufo owns the
agent, inventory, WhatsApp, and check-ups. This app holds no model keys, Twilio credentials, or
SQLite.

## Pages

| Page | Source |
| --- | --- |
| Overview | `GET /ext/restaurant_inventory/inventory` plus recent chat |
| Inventory | Same inventory projection |
| Chat | Web thread via `POST /surface/ufo/dashboard`; WhatsApp thread joined read-only |

Demo menu: **Run check-ups now** (posts into the web chat) and **Open ufo debugger**.

## Run

Requires ufo on `:8710` with the restaurant pack (see the root README Restaurant demo section).

```bash
cp .env.local.example .env.local
# UFO_BASE_URL=http://127.0.0.1:8710
# UFO_TOKEN=<contents of ~/.ufoctl/token>
npm install
npm run dev
```

Optional: `NEXT_PUBLIC_UFO_BASE_URL` for the debugger link in the Demo menu.

```bash
python3 scripts/rehearse-ufo.py   # with both servers up
```

## Env

| Key | Role |
| --- | --- |
| `UFO_BASE_URL` | ufo serve origin |
| `UFO_TOKEN` | Owner bearer from `~/.ufoctl/token` |
| `NEXT_PUBLIC_UFO_BASE_URL` | Debugger link only |
