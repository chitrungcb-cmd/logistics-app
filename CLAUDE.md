# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev          # start dev server (Turbopack) at localhost:3000
npm run build        # production build (also runs the TypeScript check)
npm run start        # run the production build
npm run lint         # ESLint (flat config, eslint-config-next core-web-vitals + typescript)

npm run db:generate  # regenerate the Prisma client into src/generated/prisma (also runs on `npm install` via postinstall)
npm run db:migrate   # create/apply a local dev migration (prisma migrate dev)
npm run db:studio    # open Prisma Studio
```

There is no test runner configured yet.

To run a single lint check on one file: `npx eslint path/to/file.tsx`.

## Architecture

Next.js App Router project (`src/app`) with a PostgreSQL (Supabase) database accessed through Prisma, and
a sidebar-driven layout for a set of logistics modules ("Khách hàng"/Customers, "Lô hàng"/Shipments,
"Nhiệm vụ"/Tasks, "Chi phí"/Costs, "Tin nhắn"/internal chat, and "Công nợ"/Debt management are
implemented so far).

### Prisma / database

- **`prisma/schema.prisma`**'s main model is `Shipment`, still intentionally flat for its own business
  fields (`customerName`, `declarationNo`, `customsType`, `port`, `goodsName`, `channel`, `status`,
  `customsOffice`, `transport`, `totalAmount`, `note`) which map directly to the columns shown in the
  `/shipments` UI. `shipmentCode` is server-generated (`generateShipmentCode()` in
  `src/lib/shipment-constants.ts`, format `LH<YYYYMMDD>-<4 digits>`) — it is never collected from a form.
  `attachments` is a `Json` column holding an array of `{ name, url, uploadedAt }` (see `Attachment` type
  in the same file), not a real file-storage integration.
- **`Customer`** (`companyName`, `taxCode` unique, `address`, `legalRepName`, `legalRepIdNumber`, `phone`,
  `email`, `notes`) is a real relation, but deliberately optional on `Shipment` (`Shipment.customerId String?`,
  `onDelete: SetNull`) — `Shipment.customerName` stays a plain string and remains the field every other part
  of the codebase (list/detail pages, Gmail sync, badges) reads directly, so shipments created before the
  Customer module existed still display correctly with `customerId: null`. When a shipment *is* linked, the
  API re-derives `customerName` from the `Customer` record on every write (see `POST /api/shipments` and
  `PATCH /api/shipments/[id]`) rather than trusting client-sent text, so the two can't drift apart — clearing
  `customerId` back to `null` falls back to whatever free text the client sends instead.
- **`Customer.assignedUserId`** (nullable `User` relation, `onDelete: SetNull`) is the "người phụ trách"
  (account owner) for that company — see "Notifications" below for how it's used to route task-progress
  notifications.
- **`ShipmentCost`/`Quote`** are the real cost/revenue ledger for a shipment — see "Profit reporting" below.
  `Shipment.totalAmount` predates both and is now vestigial: kept (read-only, still shown as "Chi phí" on
  the detail page) so old records aren't silently blanked, but no code computes profit from it anymore.
- **Prisma client generation is non-default**: this project uses Prisma 7's new `prisma-client` generator
  (not the classic `@prisma/client` generator), configured in `prisma/schema.prisma` to output into
  `src/generated/prisma` (gitignored, regenerated via `postinstall`/`db:generate`). The generated entry
  point is `src/generated/prisma/client` (not `.../prisma` or an `index.ts`) — always import from
  `@/generated/prisma/client`.
- **Driver adapters are required**: this generator does not bundle a query engine binary for the
  datasource the way the classic client did. `PrismaClient` must be constructed with a driver adapter
  (`@prisma/adapter-pg`, backed by `pg`) — see `src/lib/prisma.ts`, which also implements the standard
  dev-mode singleton pattern to avoid exhausting connections under Next.js hot reload.
- **Config lives in `prisma.config.ts`**, not the `datasource` block of the schema (Prisma 7 no longer
  supports `directUrl` in the schema file itself) — this is where the CLI's connection URL is wired up
  (via `dotenv/config`, since Prisma does not auto-load `.env` for this generator) and where the
  migrations path is set.
- **Two separate database URLs, split by purpose** (Supabase pooling requirement): `DATABASE_URL` is the
  pgbouncer *transaction-mode* pooler (port 6543) — used by the app's runtime `PrismaClient` in
  `src/lib/prisma.ts`, safe for serverless/many short-lived connections. `DIRECT_URL` is the
  *session-mode* pooler (port 5432) — used only by `prisma.config.ts` for CLI commands
  (`migrate`/`studio`/`generate`), because transaction-mode pooling doesn't support the prepared
  statements DDL migrations need. Don't swap these or point the CLI at `DATABASE_URL`.
- `prisma migrate dev` requires an interactive TTY for confirmations and will fail in non-interactive
  shells/agents with "environment is non-interactive". In that case write the migration SQL by hand under
  `prisma/migrations/<timestamp>_<name>/migration.sql` and apply it with `npx prisma migrate deploy`
  (non-interactive), then `npx prisma generate`.

### API routes (`src/app/api/**/route.ts`)

Every route returns a consistent JSON envelope via `src/lib/api-response.ts`
(`apiSuccess(data, status?)` / `apiError(message, status?)`, i.e. `{ success, data }` or
`{ success, error }`), and dynamic route params are `Promise`-typed and must be `await`ed (Next 16
convention — see `AGENTS.md`).

- `GET/POST /api/shipments` — list (newest first) / create. `POST` only requires `customerName`, unless
  `customerId` is also sent, in which case `customerName` is overwritten from the looked-up `Customer`.
- `GET/PATCH /api/shipments/[id]` — detail (404 if missing) / partial update. `PATCH` only accepts a
  fixed allowlist (`UPDATABLE_FIELDS` in the route file: `totalAmount`, `transport`, `status`, `note`,
  `attachments`, `customerId`, `customerName`) — extend that list deliberately if a new editable field is
  added, don't just spread the request body into `data`.
- `GET/POST /api/customers` — list (optionally `?search=` matching `companyName`/`taxCode`, used by both the
  `/customers` list page and `CustomerCombobox`'s autocomplete) / create. Both require login; `POST` is
  blocked for `FIELD_STAFF` (403).
- `GET/PATCH/DELETE /api/customers/[id]` — `GET` includes the customer's linked `shipments` and
  `assignedUser` (for the detail page's "Lô hàng đã làm" table and "Người phụ trách" field) and is
  readable by every role; `PATCH`/`DELETE` are blocked for `FIELD_STAFF` — this module is the one place so
  far where a role can read but never write.
- `GET /api/notifications` — the current user's own notifications only (never another user's), newest 30
  plus a separate unread `count` query (not capped by the same limit, so the bell badge stays accurate
  even past 30 unread). `PATCH /api/notifications/[id]` / `POST /api/notifications/mark-all-read` mark
  read; there's no `POST /api/notifications` — see "Notifications" below for how they're created.
- `POST /api/upload` — accepts multipart `FormData` with a `file` field, writes it via
  `saveUploadedFile()` (`src/lib/save-upload.ts`) to `public/uploads/<timestamp>-<random>-<sanitized-name>`
  (created if missing), returns `{ name, url }`. This is local-disk storage, not S3/Supabase Storage — fine
  for local dev, but files won't survive a serverless deploy or persist across instances. The list page
  (`AttachmentsCell`) calls this, then `PATCH`es the returned `{ name, url }` onto the shipment's
  `attachments` array — there is no separate "create attachment" endpoint. `/api/gmail/sync` uses the same
  `saveUploadedFile()` helper for email attachments.
- `GET /api/gmail/auth`, `GET /api/gmail/callback`, `GET /api/gmail/status`, `POST /api/gmail/sync` — see
  "Gmail declaration sync" below.

### Frontend structure (`src/app`)

- **Route groups split protected vs. public pages**: `src/app/(app)/` holds every page that requires
  login (dashboard, shipments, tasks, users, ...) and its `layout.tsx` renders `<Sidebar />`
  (`src/components/Sidebar.tsx`, a Server Component that calls `getCurrentUser()` to know the signed-in
  user/role). `src/app/login/` sits outside that group so it does *not* get the sidebar — both share the
  bare root `src/app/layout.tsx` (fonts + `<html>/<body>` only). When adding a new page, decide which side
  of that split it belongs on; don't add sidebar-requiring UI directly under `src/app/`.
- Nav items are hardcoded in `Sidebar.tsx`; `PlaceholderPage` (`src/components/PlaceholderPage.tsx`) is
  the stub used by every module that isn't built yet (`/costs`, `/debts`, `/documents`, `/reports`).
- `CustomerCombobox` (`src/components/customers/CustomerCombobox.tsx`) is a fully-controlled autocomplete
  (no internal echo of its `customerName` prop, so it never needed a prop-sync effect) used on both the
  shipment create and edit forms — typing free text clears `customerId` back to `null`, picking a suggestion
  sets both. Reused as-is rather than building a separate "shipment picker" component.
- `/shipments`, `/shipments/new`, `/shipments/[id]`, `/tasks/*`, `/customers/*` are all client components
  (`"use client"`)
  that fetch from the API routes above with `fetch`, rather than reading Prisma directly in server
  components — keep new module UI consistent with that pattern unless there's a reason to switch. (The
  `page.tsx` for pages needing an auth/role gate *is* a Server Component that calls `getCurrentUser()` and
  `redirect()`s before rendering a client child — see `src/app/(app)/tasks/page.tsx` for the pattern.)
- `src/lib/shipment-constants.ts` is the single source of truth for `CHANNEL_OPTIONS`, `STATUS_OPTIONS`,
  `CUSTOMS_TYPE_OPTIONS`, and the badge color mappings (`channelBadgeClass`, `statusBadgeClass`) — the
  create form, detail page, and list page all import from here rather than hardcoding option lists.
- `src/lib/types.ts` (`ShipmentDTO`) is the frontend-side shape of a shipment as it comes back over JSON
  (dates as ISO strings, `attachments` typed as `Attachment[] | null`) — distinct from the Prisma-generated
  `Shipment` type, which has `Date` objects and an untyped `Json` field.
- Tailwind v4 (`@tailwindcss/postcss`, zero-config) is wired in via `postcss.config.mjs` and
  `@import "tailwindcss"` in `src/app/globals.css`; there is no `tailwind.config.*` file. A shared `.input`
  utility class (form fields) is defined in `globals.css` via `@layer components`.

### Gmail declaration sync (auto-creates/updates shipments from customs declaration emails)

This mailbox's declaration emails (`nqlogisticsvn@gmail.com`, a customs brokerage inbox) carry almost no
body text — the actual data lives in an attached VNACCS "Tờ khai hàng hóa nhập/xuất khẩu (thông báo kết
quả phân luồng)" printout, an Excel file whose name always contains "ToKhai" (e.g.
`ToKhaiHQ7N_108374849920.xlsx`). The sync feature searches for exactly those emails and parses that file
rather than the email subject/body.

- **`src/lib/tokhai-parser.ts`** (`parseTokhaiExcel`) reads the declaration workbook with `xlsx` and
  extracts fields by **label text**, not fixed cell coordinates — it scans every row for a cell matching a
  known Vietnamese label (e.g. `"Số tờ khai"`, `"Mã phân loại kiểm tra"`) and takes the next non-empty
  cell(s) in that row, because the sheet is full of merged/empty cells that make positional indexing
  fragile. This was validated against real sample declarations in `~/Downloads/ToKhaiHQ7N_*.{xls,xlsx}`
  (both import and export declarations, `.xls` and `.xlsx`) — see git history / PR description for the
  label→field mapping table if the parser needs extending.
  - `channel` is derived from the "Mã phân loại kiểm tra" code: `1`→Xanh, `2`→Vàng, `3`→Đỏ.
  - `customsType` combines the doc title ("...nhập khẩu..." vs "...xuất khẩu...") with the "Mã loại hình"
    code, e.g. `"Nhập khẩu (A11)"`.
  - `port` reads "Địa điểm dỡ hàng" (import: unloading point) or falls back to "Địa điểm xếp hàng" (export:
    loading point) — these are two different labels depending on declaration direction.
  - `customerName` is uppercased on purpose: the source cell is visually all-caps in Excel via a
    small-caps font trick, but the underlying string is mixed-case, which would otherwise store garbled
    casing like `"CôNG TY Cổ PHầN..."`.
  - Also extracts `firstDeclarationNo` ("Số tờ khai đầu tiên" — see matching below) and, from the free-text
    "Phân loại chỉ thị của Hải quan" instructions log, `consultationDate` (a `"TGTV: dd/mm/yyyy"` marker —
    price-consultation appointment date) and `hasStorageInstruction` (a `"bảo quản"`/`"MHVBQ"` keyword —
    goods released to bonded storage pending inspection).
  - Returns `null` if no `"Số tờ khai"` cell is found at all — callers must treat that as "not a valid
    declaration file", not fall back to guessing.
  - `parsed.goodsName` (the "Tên hàng" cell) is extracted but **not** what ends up on the `Shipment` —
    `goodsName` is instead set from the Gmail message's own Subject header (`getSubject()` in
    `src/app/api/gmail/sync/route.ts`), since that's what staff actually recognize a shipment by in their
    inbox. `parsed.goodsName` is kept only as the fallback when a message somehow has no subject.
- **`GET /api/gmail/auth`** redirects to Google's OAuth consent screen (scope: `gmail.readonly`,
  `access_type=offline`, `prompt=consent` to force a refresh token every connect). **`GET
  /api/gmail/callback`** exchanges the code, fetches the connected email via `users.getProfile`, and
  **replaces** any existing `GmailAuth` row (single-mailbox app — only one connection is tracked at a
  time). Requires `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` in `.env` (a Google
  Cloud OAuth Web application client with `http://localhost:3000/api/gmail/callback` as an authorized
  redirect URI). Because the OAuth consent screen is unverified ("Testing" status) and requests a
  sensitive scope, Google may expire the refresh token after ~7 days — the UI's "Kết nối Gmail" button
  handles re-connecting, no code changes needed.
- **`POST /api/gmail/sync`** (triggered by the "Đồng bộ ngay" button in `GmailSyncPanel`, no cron/webhook
  yet): searches Gmail for `has:attachment (ToKhaiHQ7N OR ToKhaiHQ7X)` (Gmail's `filename:` operator needs
  an exact token, not a substring, so these are the literal observed filename prefixes — see
  `isDeclarationFile`). Each call paginates until it collects `NEW_MESSAGES_PER_SYNC` (150) messages *not
  already in* `ProcessedEmail`, not until it's seen that many raw messages — Gmail returns newest-first, so
  capping by raw-seen would keep re-scanning an already-done page forever and never reach older backlog.
  For each new match it downloads every attachment via `saveUploadedFile` (skipping any name already
  recorded on the matched shipment, so re-running sync after a bug fix doesn't duplicate files) and calls
  `findMatchingShipment`, which tries, in order:
  1. Exact `declarationNo` match (same message reprocessed, or a reply repeating the same declaration).
  2. `firstDeclarationNo` reference — VNACCS auto-splits a declaration with >50 line items, and each
     split-off part names the true original in this field. Authoritative; the split parts' declaration
     numbers are otherwise unrelated-looking.
  3. Shared `invoiceNo` — the *only* way to find the record when VNACCS reissues the same declaration
     under a new number (a real amendment/resubmission), since nothing cross-references the old number in
     that case. (Do not resurrect matching by shared 11-digit declaration-number prefix — that was tried
     and produced false positives, merging two genuinely unrelated declarations that happened to be issued
     by the same customs office around the same time.)
  - **Match found** → `mergeDeclarationBranch()` (`src/lib/shipment-constants.ts`) decides whether the new
    declaration number replaces the existing one in `declarationBranches` (same 11-digit prefix = the
    *same* declaration, just amended — replace in place) or is appended as a genuinely new branch
    (different prefix = a real split part). `declarationNo` is always `declarationBranches[0]`. Also
    updates `channel`, `customsType`, `customsOffice`, `declarationDate`, `invoiceNo`, `goodsName` (from the
    email subject, see above), `port`, `consultationDate`, and `status` (only overridden to `"Thông quan"` if
    the attachment filename contains
    `"qdtq"` — a separate "Quyết định thông quan" document — or to `"Đưa hàng về bảo quản"` if
    `hasStorageInstruction`; otherwise left alone). Deliberately does **not** touch `customerName`/`taxCode`
    on an existing record — staff may have hand-corrected those.
  - **No match** → creates a new `Shipment`, seeding `declarationBranches` from `firstDeclarationNo` +
    `declarationNo` the same way, and populating `customerName`/`taxCode` from the parse this one time.
  - Every processed message gets a `ProcessedEmail` row via `recordProcessedEmail()` (an `upsert`, not
    `create` — Gmail's search pagination has been observed returning the same message ID across two pages
    in one run, and an `upsert` no-ops instead of throwing a unique-constraint error the second time).
    Genuinely unexpected failures (network blip, etc.) do **not** get a `ProcessedEmail` row, so the next
    sync run retries them instead of silently giving up forever.
  - `generateShipmentCode()` includes a millisecond-timestamp component, not just a 4-digit random
    suffix — bulk-syncing hundreds of messages in a tight loop hit real collisions on the random-only
    version (birthday paradox).

### Notifications

- **`Notification`** (`src/lib/notifications.ts`) is created server-side only — there's no `POST
  /api/notifications`, just `notifyTaskAssigned()` and `notifyTaskProgressUpdate()`, called from inside
  `src/app/api/tasks/route.ts` (`POST`) and `src/app/api/tasks/[id]/route.ts` (`PATCH`) after the task
  write succeeds. Never notify the acting user about their own action — both helpers filter the actor out
  of the recipient list.
  - `notifyTaskAssigned` fires when a task's `assignedToUserId` is set for the first time (`POST
    /api/tasks`) or changed to someone else (`PATCH`) — recipient is the new assignee.
  - `notifyTaskProgressUpdate` fires when `status` changes on `PATCH` — recipients are `Customer
    .assignedUserId` (the "người phụ trách" of the task's `relatedShipment.customer`, if any) and the
    task's `createdByUserId`. Both routes need `relatedShipment: { select: { ..., customer: { select:
    { assignedUserId: true } } } }` on the *pre-update* `existing` fetch to have this available.
- **`Customer.assignedUserId`** (added alongside `Notification`) is the "người phụ trách" (account owner)
  for that company — editable only by ADMIN/ACCOUNTANT in `PATCH /api/customers/[id]`'s
  `UPDATABLE_FIELDS`, but visible to every role on the `/customers/[id]` page (same "everyone can read,
  only managers can write" convention as the rest of that module).
- **`NotificationBell`** (`src/components/NotificationBell.tsx`) lives in `Sidebar.tsx`'s header row, next
  to the app title (there's no separate top navbar in this layout). It polls `GET /api/notifications`
  every 20s rather than using a websocket/SSE — acceptable given the low volume and internal-tool nature
  of this app. Clicking a notification marks it read (`PATCH /api/notifications/[id]`) and navigates to
  `relatedTaskId` first, falling back to `relatedShipmentId` — a task-linked notification always wins
  because the task itself is the more specific destination.

### Profit reporting (`ShipmentCost` / `Quote` / `/reports/profit`)

- **`ShipmentCost`** is a per-shipment cost ledger, one row per line item (`category` — one of the 9
  `CostCategory` enum values, e.g. `HAI_QUAN`, `VAN_TAI`, `KHAC` — a fixed dropdown, never free text).
  `costPrice` is **never accepted directly from a client write** — it's always server-recomputed as
  `unitPrice * quantity` in `POST /api/costs` and `PATCH /api/costs/[costId]` (the latter re-derives it
  from whichever of `unitPrice`/`quantity` wasn't part of that particular partial update, so a PATCH
  touching only `quantity` still recalculates correctly). `costPrice` always counts toward Tổng chi phí,
  whether or not it was covered by the original quote. `sellPrice` is a single direct number (not
  multiplied by quantity) and only counts toward Tổng thu when `isAdditional` is true — a ticked "Phát
  sinh ngoài báo giá" checkbox — since costs already inside the quote shouldn't be billed to the customer
  twice. `invoiceNumber`/`attachmentUrl` are the vendor's own invoice reference and supporting document,
  independent of the shipment's own `Shipment.invoiceNo`.
- **`Quote`** is a versioned log of báo giá revisions for a shipment (`quoteAmount`, `quoteDate`,
  `attachmentUrl`, `note`); only the most recent one by `createdAt` counts toward profit (see
  `computeProfit` below) — older rows stay for history, not superseded/deleted.
- **`computeProfit(costs, quotes)`** (`src/lib/shipment-cost-constants.ts`) is the single formula shared by
  `GET /api/reports/profit` — don't reimplement it inline elsewhere:
  `Tổng thu = latest Quote.quoteAmount (0 if none) + Σ sellPrice where isAdditional`,
  `Tổng chi phí = Σ costPrice (all rows)`, `Lãi/Lỗ = Tổng thu − Tổng chi phí`.
- **`src/lib/similar-shipments.ts`**'s `getGoodsKeyword()` is a deliberately simple "product type" key —
  strip the leading quantity number off `goodsName` and take the first two words (e.g. "1 MÁY KHOAN CỌC
  NHỒI CŨ 300" → "MÁY KHOAN") — used because there's no HS-code/category field on `Shipment` to group by.
  Two shipments are "similar" when this key matches exactly (no fuzzy/trigram matching). `findSimilarShipments()`
  powers two features: `GET /api/costs/category-average` (historical average `unitPrice` for the same
  `category` among similar shipments in the last 6 months, driving the "⚠ đơn giá cao bất thường" warning
  on the /costs add-cost form — non-blocking, just a heads-up) and `GET /api/costs/similar` (a
  category-by-shipment cross-tab of cost totals for the current shipment plus its 10 most recent similar
  ones, powering the "So sánh với lô hàng tương tự" modal).
- **All `ShipmentCost` CRUD lives at `/costs` only** — a flat ledger across every shipment
  (`src/app/(app)/costs/CostsClient.tsx`), filterable by lô hàng/khách hàng/danh mục/khoảng ngày/chỉ phát
  sinh ngoài báo giá. It's the *only* place in the app that creates/edits/deletes `ShipmentCost` — the
  shipment detail page deliberately shows nothing but a plain ADMIN-only link ("Xem chi phí tại trang Chi
  phí →", no amounts) rather than embedding cost data/editing itself, specifically so there's exactly one
  surface that needs a cost-visibility permission check instead of two. `Quote` management is unaffected
  by this and still lives on the shipment detail page (`ShipmentFinancials.tsx`, ADMIN + ACCOUNTANT).
  `/costs` has no capacity limit or shipment-status gate on adding cost rows — real costs can keep
  arriving well after a shipment clears customs, so `POST /api/costs` never checks `Shipment.status`
  or any date cutoff. Every summary on the page (the 4 KPI cards, "Tổng chi phí theo lô hàng", the
  `CostDetailPanel` slide-over) derives from live queries/state, not a cached snapshot, so a newly
  added row is reflected everywhere immediately with no extra invalidation logic needed.
  "Cá nhân" (both the KPI card and the equivalent block inside `CostDetailPanel`) = `Σ sellPrice` −
  `Σ costPrice where invoiceNumber is non-empty` — a distinct metric from `computeProfit`'s "Lãi/Lỗ"
  (which uses the Quote-based `Tổng thu`, not raw `sellPrice`, and counts *all* `costPrice` regardless
  of invoice). Don't conflate the two — "Cá nhân" and "Lợi nhuận tạm tính" intentionally use different
  formulas on the same `/costs` page (see the 4 KPI cards in `CostsClient.tsx`).
  `COST_CATEGORY_BADGE_CLASS`/`COST_CATEGORY_ICON` (`shipment-cost-constants.ts`) are purely
  decorative — one color/emoji per category so the ledger table and `CostDetailPanel` are scannable at
  a glance; they carry no data meaning.
- **The "+ Thêm chi phí" form is single-row, one category at a time** (`CostsClient.tsx`) — all 9
  categories are equal, no special-casing (an earlier revision tried a bulk 9-category-at-once form and
  a "Hải quan/Vận tải can't have a sellPrice" restriction; both were explicitly reverted — not what was
  asked for). One shared `<form onSubmit={handleSubmit}>` handles both create (`POST /api/costs`) and
  edit (`PATCH /api/costs/[id]`, via "Sửa" on a row) — `form.id` set means edit. On a *successful create*
  the modal deliberately stays open and only resets the category/amount fields (`resetCategoryFields()`),
  keeping the same shipment selected — entering several cost lines for one shipment is "pick category,
  fill in amounts, submit, repeat" without re-searching the shipment each time. On a successful *edit*
  the modal closes as normal (`resetForm()` + `setIsFormOpen(false)`). Clicking a shipment row in "Tất cả
  lô hàng" opens this same create form pre-filled with that shipment already selected.
  `GET /api/costs/category-average?shipmentId=X&category=Y` (historical average unitPrice among
  similar-goodsName shipments, last 6 months) drives the 30%-over-average anomaly warning in this form —
  the same endpoint also supports a no-`category` "all 9 at once" mode (`byCategory`), a leftover from the
  reverted bulk form that nothing currently calls but was left in place since it's harmless and generic.
  The 9-categories-side-by-side view still exists, just only in `CostDetailPanel.tsx`'s "So sánh chi phí /
  báo giá" table (opened via "Xem" on a row) — that one is deliberately a read-only comparison across a
  shipment's whole history, not an entry form; keep these two screens separate, don't merge them back.
- **`CostAuditLog`** records every create/update/delete on a `ShipmentCost` (`src/lib/cost-audit-log.ts`
  — `logCostAudit()` for CREATE/DELETE, `buildUpdateDetail()` diffs the pre-update row against the PATCH
  body to build a human-readable "field: old → new" summary for UPDATE). `shipmentCostId` is nullable
  with `onDelete: SetNull` specifically so a DELETE entry survives the row it refers to being gone —
  `shipmentId` is stored directly alongside it for the same reason, so history stays queryable per
  shipment even after individual cost rows are deleted. Surfaced via `GET /api/costs/audit-log` in
  `CostDetailPanel`'s "Lịch sử thao tác" section (ADMIN-only, like everything else cost-related).

### Internal chat (`Conversation` / `Message` / `/messages`)

- **No role restriction** — unlike costs/quotes, every role can use chat freely (it's internal comms,
  not financial data). `Conversation.type` is `DIRECT` (1-1), `GROUP` (ad hoc, any role can create,
  optionally tied to `relatedShipmentId`), or `COMPANY` (exactly one row app-wide, containing every
  user).
- **`src/lib/chat.ts`** has the three pieces of conversation-creation logic that need to stay
  consistent, not reimplemented inline: `ensureCompanyConversation()` (lazily creates the single
  COMPANY row + backfills any user who isn't a member yet — called from `GET /api/conversations` since
  this serverless-style Next.js app has no "on startup" hook to do it once), `addUserToCompanyConversation()`
  (called from `POST /api/users` so a brand-new account is in the company channel immediately, not just
  whenever `ensureCompanyConversation()`'s backfill next happens to run), and
  `findOrCreateDirectConversation()` (never duplicates a DIRECT conversation between the same two users
  — checked by exact 2-member match, not just "both are members of *some* conversation").
- **`ConversationMember.lastReadAt`** (nullable — null means "never read", so every message counts as
  unread) drives both the unread badge in `MessagesClient.tsx`'s conversation list and the
  `unreadCount` computed per-conversation in `GET /api/conversations` (messages from *other* senders
  created after `lastReadAt`). Opening a conversation calls `POST /api/conversations/[id]/read`
  immediately, before the message list even finishes loading.
- **No realtime/WebSocket** — deliberately simple polling instead (`MessagesClient.tsx`: conversation
  list every 10s, active conversation's messages every 5s), per explicit instruction to prefer the
  simple approach over standing up infrastructure for this. `Conversation.updatedAt` is bumped by an
  empty `.update({ data: {} })` call after every new message specifically so `GET /api/conversations`
  can sort by latest activity with a plain `orderBy`, without a subquery over `Message`.
  `@mention` autocomplete (`MessagesClient.tsx`) only matches a trigger at the *end* of the current
  text (`/@(\S*)$/`) — a deliberate simplification, not mid-text cursor-position tracking.
- **`notifyNewMessage()`** (`src/lib/notifications.ts`) sends one notification per conversation member
  other than the sender — a mentioned member gets `MENTIONED` instead of an additional `NEW_MESSAGE`
  (a mention is a stronger signal, not a second notification for the same message). `NotificationBell`
  checks `relatedTaskId` → `relatedConversationId` → `relatedShipmentId` in that order when navigating on
  click, landing on `/messages?conversationId=X` for chat notifications.
- **Profit visibility is enforced at the API layer, not the UI** — `GET/POST/PATCH/DELETE
  /api/costs(/[costId])`, `GET /api/costs/category-average`, `GET /api/costs/similar`, and `GET
  /api/reports/profit` 403 anyone who isn't `ADMIN` (yes, including `ACCOUNTANT`); `/api/shipments/[id]
  /quotes(/[quoteId])` allow `ADMIN` and `ACCOUNTANT` but 403 `FIELD_STAFF`. The shipment detail page's
  role plumbing (`src/app/(app)/shipments/[id]/page.tsx`, a Server Component wrapper around
  `ShipmentDetailClient` passing `role` down — refactored from a single client component specifically to
  make this possible) is what lets `ShipmentFinancials` know whether to show the ADMIN-only `/costs` link.
  `/reports/profit` and `/costs` both go further: the whole page redirects non-`ADMIN` away, per an
  explicit requirement that both are ADMIN-only end to end.
- **`/reports/profit`** (`ProfitReportClient.tsx`) fetches the full ADMIN-only per-shipment dataset from
  `GET /api/reports/profit` *once* and does all bucketing/filtering client-side (day/week/month/quarter/
  half-year/year, via `src/lib/report-period.ts`) rather than re-querying per period/year change — fine at
  this data volume (hundreds of shipments), and it's what makes clicking a chart bar/table row able to
  instantly filter the detail table with no round trip. `report-period.ts`'s "week" is a plain 7-day
  bucket reset every Jan 1, not ISO-8601 Monday-start weeks — deliberate simplification to avoid ISO
  week-numbering's year-boundary edge cases (a date's ISO week can belong to the *other* year), which
  isn't worth the complexity for an internal report. Uses `recharts` (added specifically for this
  feature — first chart in the app).

- **This is Next.js 16: the file is `src/proxy.ts`, not `middleware.ts`** — Next 16 renamed Middleware to
  Proxy (same mechanics). `src/proxy.ts` does an *optimistic* check only (verifies the session JWT's
  signature, no DB call) and redirects to `/login` if missing/invalid; its `matcher` excludes `/api` on
  purpose (matches Next's own recommended default) so it never blocks server-to-server calls like the
  Gmail sync trigger. Real (secure) authorization happens per-request in `getCurrentUser()`
  (`src/lib/auth.ts`), which re-fetches the user's role fresh from the DB — call it at the top of every
  Server Component page and Route Handler that needs auth, don't rely on Proxy alone.
- **Session** = a `jose`-signed JWT (`{ userId }`, 7-day expiry, `AUTH_SECRET` in `.env`) in an HttpOnly
  cookie (`SESSION_COOKIE` = `"session"`). `bcryptjs` hashes passwords. No session table — logout just
  clears the cookie; there's no server-side revocation.
- **Roles**: `ADMIN`, `ACCOUNTANT`, `FIELD_STAFF` (`UserRole` enum). `ADMIN`/`ACCOUNTANT` are treated as
  "managers" almost everywhere (full CRUD on `Task`, can list all `User`s to assign work); `FIELD_STAFF` is
  restricted to their own assigned `Task`s. When adding a new permission check, prefer `role !==
  "FIELD_STAFF"` over enumerating `"ADMIN" || "ACCOUNTANT"` to match this convention.
- **First-run setup, not a seed script**: there's no way to create the first user other than through the
  app. `GET /api/auth/setup` reports `needsSetup: true` while `User` count is 0; `/login` shows a
  "create admin" form instead of the login form in that state, and `POST /api/auth/setup` only succeeds
  while the table is still empty (always creates `role: "ADMIN"`). After that, only an existing ADMIN can
  create more users (`POST /api/users`).
- **Task permission split** lives in `src/app/api/tasks/[id]/route.ts` as two allowlists:
  `FIELD_STAFF_EDITABLE_FIELDS` (`status`, `description`, `attachmentUrl` — description doubles as a
  progress note, there's no separate field for it) vs `MANAGER_EDITABLE_FIELDS` (everything, including
  `assignedToUserId`). `PATCH` filters the request body against whichever list applies instead of trusting
  the caller — extend the right list, don't just merge the whole body into `data`.
- **`SHIPMENT_TASK_STEPS`** (`task-constants.ts`) is the fixed 6-title workflow ("Khai 119" → ... →
  "Lưu trữ đủ bộ hồ sơ") shown as a horizontal stepper (`TaskStepper.tsx`, shipment detail page;
  `TaskStepperCompact.tsx`, dots on the `/shipments` list). A step is matched to a `Task` purely by
  **exact title string** + `relatedShipmentId` — there's no dedicated column marking a `Task` as one of
  these steps, and nothing currently auto-creates them for a new shipment (that was a separate,
  never-finalized request — see git history). Until something creates `Task` rows with these exact
  titles linked to a shipment, the stepper just shows all 6 steps as not-yet-created (gray, unclickable).
  `GET /api/shipments/[id]/task-steps` (full detail: status/assignee/updatedAt per step) and `GET
  /api/shipments/task-steps-summary` (statuses only, batched across *every* shipment in one query — the
  list page has no pagination, so one call per row would mean hundreds of requests) are both
  intentionally visible to every role, unlike `GET /api/tasks` which restricts `FIELD_STAFF` to their own
  assigned tasks — this is a read-only progress overview, not the task list itself.

### Debt management (`Vendor` / `Debt` / `Payment` / `/debts`)

- **`Vendor`** is a free-text `type` field (not an enum like `CostCategory`) since the list of
  transporters/kho bãi/customs agents isn't as fixed — created inline from `VendorCombobox.tsx`'s
  "+ Tạo nhà cung cấp mới" option while filling out the add-debt form, no separate `/vendors` page exists.
- **`Debt.type`** (`RECEIVABLE` from a `Customer`, `PAYABLE` to a `Vendor`) determines which of
  `customerId`/`vendorId` is populated — the other stays `null`; this isn't enforced at the DB level, only
  validated in `POST /api/debts`.
- **`Debt.status` only ever stores `UNPAID`/`PARTIAL`/`PAID`** — always server-recomputed via
  `computeDebtStatus(totalAmount, paidAmount)` (`src/lib/debt-constants.ts`) after every `Payment`
  create (`POST /api/debts/[id]/payments`) or `totalAmount` edit (`PATCH /api/debts/[id]`), never accepted
  directly from a client write. **"Quá hạn" (overdue) is deliberately not a 4th stored status value** —
  it's a display-only flag (`isOverdue()`, `debtStatusBadge()`) derived from `dueDate` vs. now at read
  time, because a debt can be simultaneously `PARTIAL` and overdue; collapsing that into one enum value
  would lose whichever fact isn't picked. The red "Quá hạn" badge on `/debts` always wins visually over
  the gray/yellow/green status badge when both would apply.
  `paidAmount`/`remainingAmount` are never stored columns either — always computed server-side from
  `Σ Payment.amount` (see `sumPayments()`) at request time in every route that returns a `Debt`.
- **`GET /api/debts` fetches every debt unfiltered, once** (mirrors the `/costs` "fetch all, filter
  client-side" pattern) — `/debts`' 3 KPI cards (Tổng phải thu / Tổng phải trả / Tổng quá hạn) need totals
  spanning both RECEIVABLE and PAYABLE at once, so the 2-tab UI (`DebtsClient.tsx`) filters this same
  unfiltered list client-side per tab rather than re-querying per filter/tab change. "Tổng quá hạn"
  combines both types into one figure (not split RECEIVABLE-quá-hạn vs. PAYABLE-quá-hạn) — a reasonable
  default picked where the original spec left this ambiguous.
- **`GET /api/debts/suggest-amount?shipmentId=X&type=RECEIVABLE|PAYABLE`** prefills (never auto-creates) a
  `totalAmount` when the user picks a related shipment while manually creating a `Debt`: RECEIVABLE
  suggests the shipment's latest `Quote.quoteAmount` (visible to ACCOUNTANT, same as elsewhere); PAYABLE
  would suggest `Σ ShipmentCost.costPrice`, but `costPrice` is ADMIN-only data (see "Profit reporting"
  above) — **an ACCOUNTANT gets `suggestedAmount: null` for a PAYABLE lookup instead of the real figure**,
  so this convenience feature can't become a side channel that leaks giá vốn to a role that's blocked from
  seeing it everywhere else in the app.
- **Permissions are deliberately not restricted like the Cost module**: both ADMIN and ACCOUNTANT get full
  read/write on `Vendor`/`Debt`/`Payment` (`role !== "FIELD_STAFF"` gates every route in
  `/api/vendors/**` and `/api/debts/**`) — `FIELD_STAFF` has no access at all, and `/debts`'s
  server-wrapper `page.tsx` files redirect it away before rendering. The "Công nợ" sidebar link is only
  pushed onto the nav list for `ADMIN`/`ACCOUNTANT` (`Sidebar.tsx`).
- The aging report (0-30/31-60/61-90/>90 ngày quá hạn buckets) on `/debts` is computed client-side from
  the same already-fetched unfiltered debt list, scoped to the active tab — no separate endpoint.

## Environment

`DATABASE_URL` and `DIRECT_URL` (PostgreSQL connection strings, see above) are read from `.env`. `.env*`
is gitignored. Gmail sync needs `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (see
above) — the app runs fine without them, the sync panel just shows "Chưa kết nối Gmail". Auth needs
`AUTH_SECRET` (any long random string; changing it invalidates all existing sessions).
