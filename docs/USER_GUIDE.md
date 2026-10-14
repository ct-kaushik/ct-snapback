<p align="center">
  <img src="../web/public/logo.png" width="360" alt="Coalition Snapback" />
</p>

<h1 align="center">Coalition Snapback — User Guide</h1>

<p align="center"><i>Scheduled, multi-store backup &amp; restore for your Shopify catalog — products, collections, and every metafield.</i></p>

---

## Table of contents

1. [What Coalition Snapback does](#1-what-coalition-snapback-does)
2. [Requirements](#2-requirements)
3. [Install &amp; launch](#3-install--launch)
4. [First run — create your admin account](#4-first-run--create-your-admin-account)
5. [Connect a Shopify store (custom app + API token)](#5-connect-a-shopify-store-custom-app--api-token)
6. [The dashboard &amp; navigation](#6-the-dashboard--navigation)
7. [Take a backup](#7-take-a-backup)
8. [Schedule automatic backups](#8-schedule-automatic-backups)
9. [Restore &amp; migrate](#9-restore--migrate)
10. [Edit-and-reupload: change a backup and restore it](#10-edit-and-reupload-change-a-backup-and-restore-it)
11. [CSV schema reference](#11-csv-schema-reference)
12. [Users, roles &amp; email (SMTP)](#12-users-roles--email-smtp)
13. [Themes](#13-themes)
14. [Troubleshooting](#14-troubleshooting)
15. [Limitations &amp; out of scope](#15-limitations--out-of-scope)
16. [Quick reference](#16-quick-reference)

---

## 1. What Coalition Snapback does

Coalition Snapback is a **self-hosted web app** that backs up and restores your Shopify **catalog** over the GraphQL Admin API (Bulk Operations). It is built for two jobs:

- **Disaster recovery** — restore a store back into itself after an accidental deletion or bad edit.
- **Migration** — copy a catalog from one store into another.

**What it captures:** products, variants, options, product images (as real downloaded files), collections (manual **and** smart/automated rules), every metafield (structured and unstructured), metafield **definitions**, metaobjects + metaobject definitions, multi-location inventory, and the published theme (as an uploadable `.zip`).

**What it is *not*:** it does **not** handle customers, orders, or discounts (see [Limitations](#15-limitations--out-of-scope)).

---

## 2. Requirements

| Need | Detail |
| --- | --- |
| **Node.js** | v20 or newer (`node -v`) |
| **A Shopify store** | with permission to create a **custom app** (account owner, or staff with "Enable app development") |
| **Disk space** | backups store CSVs + image binaries + the theme zip on your machine |
| Docker *(optional)* | only if you prefer the container route |

No external database or cloud account is required — data stays on your machine.

---

## 3. Install &amp; launch

From the project root:

```bash
npm install
```

### Option A — Development mode (two ports, hot-reload)

```bash
npm run dev
```

- **API** → `http://localhost:8080`
- **UI → `http://localhost:5173`**  ← open this in your browser

The server hot-reloads on code changes.

### Option B — Single-port build (one URL)

```bash
npm run build
```
```bash
npm start
```

Then open `http://localhost:8080` (the built UI is served by the API).

### Option C — Docker

```bash
cp .env.example .env
```
```bash
docker compose up -d --build
```

Open `http://localhost:8080`. Data persists in `./data` via a mounted volume.

> **No `.env` is needed on localhost** — encryption and session keys auto-generate under `./server/data` on first run. For production set `APP_ENCRYPTION_KEY`, `SESSION_SECRET`, and `TZ` explicitly (see [Quick reference](#16-quick-reference)).

---

## 4. First run — create your admin account

The first time you open the UI it asks you to **create the initial Admin account** (email + password). This account owns the instance and can invite other users later. After that you'll land on the **Dashboard**.

---

## 5. Connect a Shopify store (custom app + API token)

Snapback authenticates to each store with an **Admin API access token** (`shpat_…`). You create one via a **custom app inside the store admin**.

> ⚠️ **Use the store admin, *not* the Shopify Dev Dashboard.** A merchant custom app issues a stable token that Snapback accepts. Dev Dashboard / public apps produce tokens that fail with *"Non-expiring access tokens are no longer accepted."*

### 5.1 Create the custom app
1. Shopify admin → **Settings → Apps and sales channels → Develop apps**.
2. First time only: **Allow custom app development** → confirm.
3. **Create an app** → name it `Coalition Snapback` → **Create app**.

### 5.2 Grant Admin API scopes
Open **Configuration → Admin API integration → Configure**, then tick:

**Backup (read):**
```
read_products
read_metaobjects
read_metaobject_definitions
read_inventory
read_locations
read_themes
```
**Restore (write):**
```
write_products
write_metaobjects
write_inventory
```
Click **Save**.

> Inventory and theme capture **degrade gracefully** — if you omit their read scopes, the rest of the backup still runs. Skip the `write_*` scopes if you only ever want to *back up* (never restore).

### 5.3 Install &amp; copy the token
1. **API credentials** tab → **Install app** → **Install**.
2. Under **Admin API access token**, click **Reveal token once** and copy the `shpat_…` value.
   ⚠️ Shopify shows it **only once** — if you lose it, uninstall/reinstall to get a new one. (You don't need the API key/secret.)

### 5.4 Add the store in Snapback
1. In Snapback → **Connections → Add store** *(admin only)*.
2. Enter the **myshopify domain** (`your-store.myshopify.com`) and paste the **token**.
3. Click **Test connection** — it should return the shop name + currency. ✅
4. Repeat for each store (multi-store is fully supported; each store has its own token and isolated backups).

---

## 6. The dashboard &amp; navigation

The left navbar (items shown depend on your role — see [roles](#12-users-roles--email-smtp)):

| Menu | What it's for | Min role |
| --- | --- | --- |
| **Dashboard** | overview of stores, recent runs | viewer |
| **Backups** | run a backup, browse/download past backups, per-run logs | viewer |
| **Restore** | restore or migrate (incl. upload-a-zip) | operator |
| **Schedule** | set automatic backup frequency | viewer |
| **Connections** | add/manage stores &amp; tokens | admin |
| **Logs** | run history &amp; logs | viewer |
| **Users** | invite users, set roles &amp; per-store access | admin |
| **Email (SMTP)** | configure outbound email | admin |

The **store switcher** (top-right) selects which store you're acting on.

---

## 7. Take a backup

1. Pick a store in the **store switcher**.
2. Go to **Backups** → **Run backup now**.
3. Watch the **live log / stepper** — it runs in passes: Products → Variant metafields → Collections → Metafield definitions → Metaobjects → Inventory → Theme.
4. When it finishes, the backup appears in the list with **counts**, a **checksum** status, and **download** options.

A backup is a timestamped folder containing a normalized CSV set, a Shopify-importable `products_native.csv`, downloaded image binaries (`images/`), the theme zip, and a `manifest.json` with per-file SHA-256 checksums. **Only one backup runs at a time per store.**

---

## 8. Schedule automatic backups

1. Go to **Schedule** (pick the store first).
2. Choose a **frequency** — *Hourly / Daily / Weekly / Monthly* — plus a day/time.
3. It shows a **"next runs" preview**. Save. Done — **no cron syntax required** (an advanced cron field is available if you want it).

Scheduler timezone is controlled by the `TZ` setting (defaults to UTC).

---

## 9. Restore &amp; migrate

Open **Restore** (operator or admin).

1. **Source store** — pick the store whose backup you want to restore from. *(This also unlocks the upload box.)*
2. **Source backup** — either:
   - pick an existing completed backup from the dropdown, **or**
   - **upload an (edited) backup `.zip`** (see [§10](#10-edit-and-reupload-change-a-backup-and-restore-it)) — on success it's auto-selected as the source.
3. **Target store** — where to write. Same store = recovery; different store = migration.
4. **Resources to restore** — tick any of: **Definitions, Metaobjects, Products, Collections, Metafields, Inventory**.
5. **If a product/collection already exists** — choose:
   - **Overwrite** — existing records (matched by handle) are updated in place; new ones created.
   - **Skip** — existing records untouched; only new ones created.
6. **Dry-run** (default **ON**) — previews counts and writes **nothing**. Run it first.
7. Review the live log, then turn **Dry-run OFF** and **Run restore** to write for real.

### How matching works (so re-runs don't duplicate)
- **Products** match by **handle** (`productSet` upsert). A product with a blank `id` is created; an existing handle is updated.
- **Collections** match by **handle**.
- **Metafields** match by owner + namespace/key.
- **Cross-store references** (reference-type metafields, metaobject links) are **remapped by handle/SKU**; anything unresolved is logged.
- **Images** are re-uploaded from the stored binary, or fetched by Shopify from the `src` URL if no binary is present. **Image upload happens only on a real restore, not a dry-run.**

### Reading the restore summary
Each phase logs a one-line summary, e.g.:
```
Products — created: 123, updated: 11, skipped: 0
Collections — created: 6, updated: 0, skipped: 0
Metafields set: 932, skipped (owner unresolved): 0, unresolved references: 0
Inventory — variants matched: 381 (via GID 0, SKU 381, options 0), quantities set: 381 …
```

---

## 10. Edit-and-reupload: change a backup and restore it

You can download a backup, edit the CSVs (bulk price change, add new products, fix data), and upload it as a restore source. This is also how you **import a catalog built in a spreadsheet** — shape it to the schema below.

### Workflow
1. **Get the files** — download a backup (Backups page) or start from an existing backup folder.
2. **Edit the CSVs** — follow the [schema reference](#11-csv-schema-reference). Keep the header rows; save as **UTF-8**.
3. **Add images** — reference a **public https URL** in the `src`/`image_src` column (Shopify fetches it), or drop a file in `images/` and point the `file` column at `images/<name>`.
4. **Zip correctly** — ⚠️ the CSVs and `images/` folder must be at the **root** of the zip. Open the backup folder, select everything **inside** it, and compress the **selection** — do **not** zip the parent folder (that nests everything and the upload is rejected).
5. **Upload** — Restore → pick a Source store → upload the zip → it becomes the Source backup.
6. **Dry-run, then restore.**

> Uploaded backups **skip checksum verification** (you changed the files on purpose, so the manifest checksums won't match — that's expected).

---

## 11. CSV schema reference

A backup is a set of CSVs that round-trip losslessly. Key rules apply to **all** files:

- **`handle` is the join key.** Every file references a product by its `handle`; keep it identical everywhere.
- **`id` column:** leave **blank** for brand-new records (Snapback assigns it); keep the existing value for records you're updating.
- **JSON columns** (names ending `_json`, plus `tags`, `option_values`, metafield reference values) hold JSON. In CSV, wrap any field containing a comma, quote, or JSON in **double quotes** and **double every internal quote** — e.g. `"[{""name"":""Size"",""value"":""Small""}]"`.
- **Enums are UPPERCASE** (`ACTIVE`, `DENY`, `GRAMS`, …).

### `products.csv`
`id, handle, title, description_html, vendor, product_type, tags, status, template_suffix, category_id, category_name, seo_title, seo_description, options_json`
- `tags` — JSON array: `["vegan","high-protein"]`
- `status` — `ACTIVE` | `DRAFT` | `ARCHIVED` (draft = hidden from storefront)
- `options_json` — `[{"name":"Size","position":1,"values":["Small","Large"]}]`; for a product with no options use `[{"name":"Title","position":1,"values":["Default Title"]}]`

### `variants.csv`
`id, product_handle, sku, title, option_values_json, price, compare_at_price, cost, barcode, inventory_policy, taxable, tax_code, position, weight_value, weight_unit`
- `option_values_json` — `[{"name":"Size","value":"Small"}]` (single-variant: `[{"name":"Title","value":"Default Title"}]`)
- `inventory_policy` — `DENY` | `CONTINUE`
- `taxable` — `true` | `false`
- `weight_unit` — `GRAMS` | `KILOGRAMS` | `OUNCES` | `POUNDS`

### `product_images.csv`
`product_handle, position, src, alt, media_id, filename, file`
- `src` — public https URL (Shopify downloads it). `file` — local path like `images/<name>` when restoring a stored binary. Leave `media_id`/`filename` blank for new images.

### `collections.csv`
`id, handle, title, description_html, sort_order, template_suffix, seo_title, seo_description, image_src, image_alt, image_filename, image_file, collection_type, applied_disjunctively, rules_json, sources_json`
- `sort_order` — `MANUAL` | `BEST_SELLING` | `ALPHA_ASC` | `ALPHA_DESC` | `PRICE_ASC` | `PRICE_DESC` | `CREATED` | `CREATED_DESC`
- `collection_type` — `manual` or `smart`
- **Manual:** `applied_disjunctively`/`rules_json` blank, `sources_json` `[]`; list products in `collection_products.csv`.
- **Smart:** `applied_disjunctively` = `false` (match ALL) / `true` (match ANY); `rules_json` = `[{"column":"TAG","relation":"EQUALS","condition":"Breakfast"}]`; do **not** list products (Shopify fills by rules).
  - Rule **column**: `TAG` `TITLE` `TYPE` `VENDOR` `VARIANT_PRICE` `VARIANT_COMPARE_AT_PRICE` `VARIANT_WEIGHT` `VARIANT_INVENTORY` `VARIANT_TITLE` `IS_PRICE_REDUCED`
  - Rule **relation**: `EQUALS` `NOT_EQUALS` `GREATER_THAN` `LESS_THAN` `STARTS_WITH` `ENDS_WITH` `CONTAINS` `NOT_CONTAINS`

### `collection_products.csv`
`collection_handle, product_handle` — one row per product in a **manual** collection. Both values must exist in their respective files.

### `metafields.csv`
`owner_type, owner_key, namespace, key, type, value`
- `owner_type` — `PRODUCT` | `PRODUCTVARIANT` | `COLLECTION`
- `owner_key` — `PRODUCT` → product handle · `PRODUCTVARIANT` → `handle::SKU` · `COLLECTION` → collection handle
- `type` — a Shopify metafield type; the matching **definition** should exist (restore creates definitions first). Values by type: text types → plain text; `number_integer` → a number; `url` → a URL; `rich_text_field` → Shopify rich-text JSON; `rating` → `{"scale_min":"1.0","scale_max":"5.0","value":"4.8"}`; `list.*` → a JSON array.
- **Reference types** (`*_reference`, e.g. `file_reference`, `product_reference`, `metaobject_reference`) hold store-specific GIDs and generally **can't be hand-authored** — set those in admin after restore.

### `inventory_levels.csv`
`variant_id, inventory_item_id, product_handle, variant_sku, option_values, location_name, tracked, on_hand, available, committed, incoming, reserved, damaged, safety_stock, quality_control`
- For new products, leave `variant_id`/`inventory_item_id` blank — matching falls back to **SKU**, then **handle + option values**.
- `location_name` must match a location in the target store (matched by name). `on_hand` is the stock number; a **blank `on_hand` is treated as 0**.

### Other files
`metafield_definitions.csv`, `metaobject_definitions.csv`, `metaobjects.csv`, `locations.csv`, `themes.csv`, `theme_files.csv`, and `products_native.csv` (Shopify-admin import format — **ignored** by Snapback's own restore). You rarely edit these by hand.

---

## 12. Users, roles &amp; email (SMTP)

### Roles
| Role | Can… |
| --- | --- |
| **Viewer** | view dashboard, backups, logs |
| **Operator** | the above **+ run backups and restores** |
| **Admin** | everything **+ manage stores, users, and settings** |

Each user is also granted access to **specific stores**.

### Inviting users
**Users → invite** (admin). Enter email, role, and the stores they may access.
- If **SMTP is configured**, the person gets an email with a **set-password** link.
- If not, the invite screen shows a **link you can share manually**.

### Email (SMTP) setup
**Email (SMTP)** (admin) → enter host / port / user / password / from → **Save &amp; verify** (it tests the connection before saving) → **Send a test**. Once configured, invites, email verification, and **Forgot password** links are emailed automatically.

- Invite links expire in **7 days**, verification in **24 hours**, password resets in **1 hour**. Links are **single-use**.

---

## 13. Themes

The **published theme** is backed up as a ready-to-upload **`.zip`** inside each backup. Snapback does **not** restore themes programmatically — to restore, download the backup and **upload the theme zip in Shopify admin** (Online Store → Themes → Upload). This keeps the riskiest surface manual and safe.

---

## 14. Troubleshooting

| Symptom | Cause &amp; fix |
| --- | --- |
| **`EADDRINUSE: address already in use :8080`** on start | A previous server is still running. Stop the stale `node` process holding the port, then start again. Running against a stale server is the #1 cause of "my fix didn't take." |
| **"Non-expiring access tokens are no longer accepted" (403)** | The app was created in the **Dev Dashboard**. Re-create it via **store admin → Develop apps** ([§5](#5-connect-a-shopify-store-custom-app--api-token)). |
| **"Authentication failed (403)"** on Test connection | A required **scope is missing**, or the token has a trailing space. Re-check [§5.2](#52-grant-admin-api-scopes) and re-paste. |
| **Upload rejected: "Not a valid Coalition Snapback backup — products.csv or collections.csv is required"** | Your zip nests everything in a subfolder. The CSVs + `images/` must be at the **root** of the zip ([§10](#10-edit-and-reupload-change-a-backup-and-restore-it)). |
| **"This reset link is invalid or has expired"** | Reset links are **single-use** and expire in **1 hour**; reset emails send only when **SMTP is configured**. Request a fresh one. |
| **Images didn't appear after restore** | Image upload happens **only on a real restore**, not a dry-run. `src` URLs must be **publicly reachable** by Shopify; a failed fetch creates the product without that image and logs a warning — re-pull by adding the binary to `images/`. |
| **Inventory shows `variants matched: 0`** | Ensure the **Inventory** resource is ticked and SKUs are present. A **blank `on_hand` is set to 0**, so verify your quantities are filled in. |
| **Products aren't visible on the storefront** | They're `DRAFT`. Set them `ACTIVE` (Shopify admin → Products → filter Draft → Set as active, or set `status=ACTIVE` in `products.csv` and re-run Products). |
| **A metafield value didn't attach** | Its **definition** must exist (make sure **Definitions** is ticked), and the `type`/value format must match the [schema](#11-csv-schema-reference). Reference types need real GIDs. |

Every run has a **live, per-run log** on the Backups and Restore pages — read it first; it names the exact Shopify error for any record that failed.

---

## 15. Limitations &amp; out of scope

- **Customers, orders, and discounts are not handled.** For customers, use Shopify's native **Customers → Import by CSV**.
- **Themes are backup-only** (manual re-upload).
- **Reference-type metafields** (`file_reference`, `*_reference`, `metaobject_reference`) and **product category / SEO** are not hand-authorable in bulk — set them in admin after restore.
- **Variant metafields** require SKUs to round-trip.
- Restore targets Shopify Admin API **2026-07** — always **dry-run against a development store first**.

---

## 16. Quick reference

### Commands
```bash
npm install            # install
npm run dev            # dev: API :8080 + UI :5173
npm run build && npm start   # single-port build on :8080
docker compose up -d --build # Docker on :8080
```

### Ports
- `5173` — Vite UI (development)
- `8080` — API, and the built UI in production

### Required Admin API scopes
`read_products, read_metaobjects, read_metaobject_definitions, read_inventory, read_locations, read_themes` (+ `write_products, write_metaobjects, write_inventory` for restore)

### Environment variables (`.env`, for production)
| Var | Purpose |
| --- | --- |
| `APP_PORT` | backend port (default 8080) |
| `DATA_DIR` | where SQLite, logs, and backups live (default `./data`) |
| `APP_ENCRYPTION_KEY` | 32-byte hex; encrypts tokens at rest (auto-generated if blank) |
| `SESSION_SECRET` | signs session cookies (auto-generated if blank) |
| `TZ` | scheduler timezone, e.g. `America/Los_Angeles` |
| `APP_BASE_URL` | public base URL (used in email links) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM` | email fallback (the in-app Settings page takes precedence) |

Generate a key:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

<p align="center"><b>Proprietary — © 2026 Coalition Technologies. All rights reserved.</b></p>
