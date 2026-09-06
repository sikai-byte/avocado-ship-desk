# Ship Desk

Ship-day order manager for a Wix store that ships perishables. Turns "key every label by hand" into:

1. Open the app on ship day — paid, unshipped Wix orders are already there.
2. Each order has a box and carrier service chosen by your rules (SKU, quantity, weight, state, wholesale). Override exceptions, hold anything you don't want to ship today.
3. Print the pick list (per-SKU totals to pull from cold storage, then per-order contents in label order).
4. **Download the Pirate Ship CSV** and bulk-import it there to buy labels at your discounted rates (optionally, buy labels directly through Shippo instead).
5. Tracking numbers are written back to Wix as fulfillments, so customers get Wix's shipping email automatically. For Pirate Ship, upload their shipments report and the app does the same.

No database — settings, overrides and label history are JSON files in `data/`. Runs on any free-tier Node host.

## Run

```bash
npm install
cp .env.example .env   # optional; without keys it uses sample orders
npm run dev            # http://localhost:3100
```

Production: `npm run build && npm start`.

## Connect to Wix

1. Wix Dashboard → Settings → **API Keys** → Generate API key with **Wix Stores / eCommerce** permissions (Read Orders, Manage Fulfillments).
2. Copy the site ID (Dashboard URL: `manage.wix.com/dashboard/<SITE_ID>/...`).
3. Set `WIX_API_KEY` and `WIX_SITE_ID` in `.env`. Set `WIX_ACCOUNT_ID` too if the key is account-level.
4. Make sure each Wix product has a **weight** set — the app uses it for postage.

Orders that chose local pickup are skipped. SKUs starting with the wholesale prefix (default `WS-`) are treated as wholesale.

## Labels

- **Shippo** (`SHIPPO_API_KEY`): rates are fetched for each order, the configured service is chosen (falling back to the cheapest rate from the same carrier), labels are bought, merged into one 4x6 PDF, and tracking is pushed to Wix. Start with a `shippo_test_` key — it produces free sample labels.
- **Pirate Ship**: *Download Pirate Ship CSV* → Pirate Ship → Ship → Upload a spreadsheet. Column names match Pirate Ship's template; map any it doesn't recognize once and it remembers. After buying, export Reports → Shipments and use *Import tracking CSV* here.

## Rules

Settings → **Rules & boxes**. Rules run top to bottom; the first match sets the box + service. Conditions: SKUs (all must be present), destination states, channel, chosen shipping option, quantity range, weight range. Orders that match nothing use the defaults and get flagged. Also flagged: hot-weather states, incomplete addresses, international, buyer notes, missing weights.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/orders` | open orders with assignments |
| POST/DELETE | `/api/orders/:id/override` | `{boxId, serviceId, hold}` |
| GET | `/api/picklist` | pick list JSON |
| GET | `/api/export/pirateship.csv?ids=` | Pirate Ship import file |
| POST | `/api/import/tracking` | CSV body → fulfill in Wix |
| POST | `/api/labels/purchase` | `{orderIds?}` → buy via Shippo |
| GET | `/api/labels/merged.pdf?ids=\|date=` | merged label PDF |
| GET/PUT | `/api/settings` | rules, boxes, services |

Set `APP_KEY` to require `x-api-key` / `?key=` on the API.

## Develop

```bash
npm test         # vitest
npm run typecheck
```
