<p align="center">
  <img src="web/public/logo.png" width="440" alt="Coalition Snapback" />
</p>

<p align="center">
  <b>Scheduled, multi-store backup &amp; restore for your Shopify catalog — products, collections, and every metafield.</b>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white" alt="Node 20+" />
  <img src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB" alt="React" />
  <img src="https://img.shields.io/badge/Fastify-000000?logo=fastify&logoColor=white" alt="Fastify" />
  <img src="https://img.shields.io/badge/SQLite-003B57?logo=sqlite&logoColor=white" alt="SQLite" />
  <img src="https://img.shields.io/badge/Docker-2496ED?logo=docker&logoColor=white" alt="Docker" />
  <img src="https://img.shields.io/badge/Shopify_Admin_API-2026--07-95BF47?logo=shopify&logoColor=white" alt="Shopify Admin API 2026-07" />
</p>

---

**Coalition Snapback** is a self-hosted web app that safeguards your Shopify catalog. It exports
**products, collections, variants, and all metafields** (structured *and* unstructured) to CSV on a
schedule, keeps the actual image files, and can **restore** everything back into the same store
(disaster recovery) or a different store (migration) — all from a dashboard with real-time progress,
comprehensive logs, and role-based accounts. Built on the Shopify **GraphQL Admin API Bulk Operations**.

## ✨ Features

- 🗄️ **Complete catalog backup** — products, variants, options, images, collections (**manual *and* smart/automated rules**), and **every metafield**, plus metafield **definitions** and **metaobjects** so nothing is lost.
- 📦 **Full multi-location inventory** — per-location on-hand quantities across all locations, backed up and restored (locations matched by name for cross-store).
- 🎨 **Theme backup** — the published theme is packaged as a ready-to-upload **.zip** (restore by uploading it in Shopify admin).
- 🖼️ **Real image files** — image binaries are downloaded and re-uploaded on restore, so images survive even a full store wipe.
- 🔄 **Backup *and* restore** — same-store recovery or cross-store migration, with a **dry-run preview** and **overwrite / skip** conflict handling. Restores are idempotent (matched by handle / SKU / key).
- ✏️ **Edit-and-reupload** — download a backup, edit the CSVs, re-zip, and **upload it as a restore source**.
- ⏰ **Dead-simple scheduling** — pick *Hourly / Daily / Weekly / Monthly*, a day, and a time. **No cron syntax required** (an advanced cron field is there if you want it), with a live "next runs" preview.
- 🏬 **Multi-store** — manage as many stores as you like, each with its own token, schedule, and isolated backup catalog.
- 👥 **Users, roles & email** — Admin / Operator / Viewer with per-store access; **email invites, verification, and password reset** over SMTP (configured in-app).
- 📡 **Live per-run logs** — watch the real-time log/progress for a specific backup or restore, right on the Backups and Restore pages.
- 🔐 **Self-hosted & secure** — runs on your machine or in Docker; Shopify tokens and SMTP credentials are encrypted at rest (AES-256-GCM). Your data never leaves your infrastructure.
- 📄 **Two CSV shapes** — a lossless normalized set for full restore, plus a Shopify-admin-importable products CSV.
- 🧾 **Integrity built in** — per-file SHA-256 checksums and a manifest for every backup.

### Email (SMTP) setup
Go to **Settings → Email (SMTP)** as an admin, enter your SMTP host/port/user/password/from, and **Save & verify** (it tests the connection before saving) — then **Send a test**. Once configured, inviting a user emails them a set-password link; if SMTP isn't configured yet, the invite screen gives you a link to share manually. `Forgot password?` on the sign-in screen sends a reset link.

> ☁️ Optional Google Drive upload is included but **hidden by default** (flip `DRIVE_ENABLED` in `web/src/features.ts` to enable — see [Optional: Google Drive](#optional-google-drive)).

## 🧱 Tech stack

| Layer | Choice |
| --- | --- |
| Backend | Node.js + TypeScript, **Fastify**, GraphQL Admin API (Bulk Operations) |
| Frontend | **React** + Vite + **Mantine** |
| Storage | **SQLite** (metadata) + filesystem (CSV + images) |
| Auth | Cookie sessions, bcrypt, role-based access |
| Packaging | **Docker** + Docker Compose |

## 🚀 Quick start (localhost)

```bash
npm install
npm run dev
```

- API → `http://localhost:8080`
- **UI → `http://localhost:5173`** ← open this

On first launch you'll create the initial **Admin** account. That's it — no config needed to start
(encryption/session keys auto-generate under `./server/data`).

> One port instead of two? `npm run build && npm start`, then open `http://localhost:8080`.

## 🐳 Run with Docker

```bash
cp .env.example .env    # set APP_ENCRYPTION_KEY and SESSION_SECRET
docker compose up -d --build
```

Open `http://localhost:8080`. Data (SQLite + backups) persists in `./data` via a mounted volume.

## 🔑 Connect a Shopify store

1. In the **Shopify Dev Dashboard**, create a **custom app** for your store.
2. Grant Admin API scopes:
   - **Backup:** `read_products`, `read_metaobjects`, `read_metaobject_definitions`, `read_inventory`, `read_locations`, `read_themes`
   - **Restore:** `write_products`, `write_metaobjects`, `write_inventory`
   (Inventory and theme capture degrade gracefully if their read scopes are missing — the rest of the backup still runs.)
3. Install the app and copy the **Admin API access token** (`shpat_…`).
4. In Coalition Snapback → **Connections → Add store**, paste the token and click **Test connection**. Repeat for every store.

<details>
<summary>⚙️ Configuration (.env)</summary>

| Variable | Purpose |
| --- | --- |
| `APP_PORT` | Backend port (default 8080) |
| `DATA_DIR` | Where SQLite, logs, and local backups live (default `./data`) |
| `APP_ENCRYPTION_KEY` | 32-byte hex; encrypts tokens at rest (auto-generated if blank) |
| `SESSION_SECRET` | Signs session cookies (auto-generated if blank) |
| `TZ` | Timezone for the scheduler (e.g. `America/Los_Angeles`) |
| `APP_BASE_URL` | Public base URL |

Generate a key: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
</details>

## 📦 Usage

- **Back up now** — pick a store from the switcher and hit **Run backup now**; watch the live stepper. Find the result under **Backups** (counts, checksum, downloads).
- **Schedule** — open **Schedule**, choose a frequency + time; it shows the next few run times. Done.
- **Restore** — **Restore** → choose a source backup and target store → **dry-run** to preview → confirm. Pick **Overwrite** or **Skip** for records that already exist.
- **Users** — invite Operators/Viewers and grant them specific stores.

## 🔬 How it works

**Backup:** GraphQL **Bulk Operations** export (products → variant metafields → collections → definitions → metaobjects, as separate passes to respect bulk limits) → the JSONL result is stitched by `__parentId` → a normalized CSV set + native products CSV + checksummed manifest is written, and image binaries are downloaded → stored in a timestamped folder.

**Restore:** definitions & metaobjects first, then `productSet` / `collectionCreate` (images re-uploaded via **staged uploads**), then `metafieldsSet` with reference-GID remapping. Records match on business keys, so re-runs update rather than duplicate.

## 🗂️ Project structure

```
server/   Fastify API, Shopify engine, jobs, scheduler, SQLite
web/      React + Vite + Mantine dashboard
Dockerfile · docker-compose.yml · .env.example
```

## 🗺️ Roadmap

- Retention/rotation (GFS) with auto-pruning
- Incremental backups (`updated_at` since last run)
- Smart-collection rules, inventory, translations, videos/3D
- Selective / single-product restore, upload-a-CSV restore
- Email / Slack notifications; 2FA / SSO; audit log

## ⚠️ Notes & limitations

- Restore mutations target Shopify API **2026-07** — validate against a **development store** first (there's a built-in dry-run).
- Out of scope today: per-location inventory, translations, orders/customers/discounts, app-owned metafields, and video/3D media.
- Backups run **one at a time per store**; variant metafields require SKUs to round-trip.

## <a id="optional-google-drive"></a>☁️ Optional: Google Drive

Cloud upload is built in but off by default. To enable: set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
in `.env` (OAuth client with the Drive API, redirect `…/api/drive/oauth/callback`) **and** set
`DRIVE_ENABLED = true` in `web/src/features.ts`. Each store then gets its own `Coalition Snapback/<domain>` Drive folder.

## License

**Proprietary — © 2026 Coalition Technologies. All rights reserved.** See [`LICENSE`](LICENSE).
This is a private, internal project; no reuse or distribution is permitted without written permission.
