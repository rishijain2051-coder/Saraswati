# CLAUDE.md — Saraswati Export ERP

Guidance for working in this repo.

## What this is

Modular ERP for Saraswati Export (furniture/hardware exporter). **Phase 1 =
Product Management**, **Phase 2 = Operations** (proformas → orders → production
board → payments). Manforce and Sales are still placeholders that route to
`PlaceholderModule`. Product data (costing, dimensions, differentiated volumes)
feeds Operations; Sales (container planning) comes later.

## Architecture

- npm **workspaces**: `server` + `client`.
- **server**: Express + TypeScript, Prisma → SQLite (`server/prisma/schema.prisma`).
  Run with `tsx` in dev. Swap `provider` to `postgresql` to scale; models are portable.
- **client**: React + Vite + TypeScript + Ant Design. Data via `@tanstack/react-query`
  + axios (`client/src/api/`). Vite proxies `/api` and `/uploads` to `:4000`.
- **Auth**: JWT bearer token in `localStorage`, roles Admin > Manager > Operator > Viewer
  (`server/src/middleware/auth.ts`, `client/src/auth/AuthContext.tsx`).

## Costing engine — the core

`server/src/lib/costing.ts` (pure functions) and its client mirror
`client/src/util/costing.ts` MUST stay in sync. Likewise the safe expression
evaluator exists on both sides: `server/src/lib/expr.ts` and
`client/src/util/expr.ts` — keep them identical. Formulas were reverse-engineered
and verified to the rupee against `example.xlsx` (the "Crazy Almirah", FOB
₹19,180.60 — reproduced by the seed as product `AB-00123`).

- 7 heads: MAIN_COMPONENT, SUB_COMPONENT, HARDWARE, POLISHING, PACKAGING, LABOUR, FORWARDING.
- Hierarchy: CostSheet → CostGroup (has a `method`) → CostLine (per-line `rate`).
- **Methods are DATA-DRIVEN** — stored in the `CostMethod` table with a free-form
  `expression` (vars L/W/H/AL/AW/AH/QTY/WASTAGE/WEIGHT), editable/creatable in
  Master Data → Cost Formulas. `BUILTIN_METHODS` in costing.ts seeds the six
  defaults (CFT/SQFT/SQMT/RFT/WEIGHT/QTY). `lineMeasure(methodDef, line)`
  evaluates the expression; product routes load the method map via
  `loadMethodMap()` and pass it into `computeCostSheet`.
- Measures/amounts are **computed by the API**, never stored (avoids drift).
- Roll-up: Ex-Factory excludes Forwarding; FOB adds Forwarding + FactoryExpense% +
  Margin% cumulatively; Non-FOB is the same without Forwarding.
- If you change a formula, update BOTH files and re-verify against `example.xlsx`.

## Exchange rates (ICEGATE)

The ICEGATE customs exchange-rate page is CAPTCHA-protected, so rates are NOT
fetched automatically (never bypass the CAPTCHA). Master Data → Currencies has a
human-assisted importer (`CurrencyRatesImport.tsx`): the user solves the CAPTCHA
on ICEGATE, copies the table, pastes it; the client parses the **Export** column
(last number per line) and the `POST /currencies/bulk-rates` endpoint applies it.
`rateToBase` = INR per 1 unit of the currency (base = INR).

## Operations — the production board

The factory flow is: **proforma → (accepted) → order → pieces move through stages →
each hand-over carries a note and photos → jobwork feeds Payments.**

- **Stage lines** (`StageLine` + `StageLineStep`, Master Data → Stage Lines) are the
  named routes, e.g. `X = raw joining → raw sanding → polishing → accessory fitting
  → QC → packaging`. A **product** is assigned one (`Product.stageLineId`, set in the
  wizard); each **order line SNAPSHOTS** the steps into `OrderLineStage` rows, so
  editing a master line never rewrites live orders.
- **Where pieces are is DERIVED, never stored.** `StageMove` is an append-only ledger;
  `server/src/lib/production.ts` (`buildBoard`) sums it into buckets
  `PENDING → stage 1..n → DONE`. This is the single source of truth — do not add a
  stored quantity column, it would drift.
- Move kinds and their endpoints: `RELEASE` (pending→stage), `ADVANCE` (forward),
  `REJECT` (backward / rework), `COMPLETE` (stage→done), `RETURN` (done→stage).
  `kind` is what disambiguates a null endpoint (null `toStageId` = DONE for COMPLETE
  but PENDING for REJECT). All rules live in `validateMove`; the client mirrors them
  in `client/src/pages/operations/board/moveLogic.ts` — **keep those two in sync.**
  The UI only asks for a *from* and a *to* and derives the kind, so an illegal move
  cannot be expressed.
- **Multi-step clearance:** a forward move spanning several stages is expanded by
  `expandHops()` into one `ADVANCE` per stage crossed, so each stage's `cleared`
  count — and therefore the jobwork owed for it — stays exact. **Only ADVANCE
  expands.** A rejection is one event, and a COMPLETE is taken at its word: finishing
  from stage 3 must not mark 4-6 as passed, or a vendor owning one of them would be
  paid for work nobody did. The drawer warns which stages a completion skips.
  `hopsBetween()` mirrors this client-side so the drawer can say "recorded as 3
  steps" before you commit. One submission may carry moves for several order lines
  (that is what the "Clear a stage" bulk drawer posts).
- **Outsourcing lives per stage.** `OrderLineStage.vendorId` (null = in-house) plus
  `jobworkRate` is the only source of truth, so any pattern works — stages 1-3
  in-house, 4 at a vendor, 5-6 in-house again. `OrderLine` carries no mode/vendor
  fields; `serializeOrder` derives `mode` (INHOUSE / MIXED / OUTSOURCED), `vendors`
  and `outsourcedStages`. A vendor stage with a zero rate is rejected, or it would
  silently bill nothing. Jobwork payable = pieces cleared × rate.
- **Hand-overs carry a comment and photos, not challans.** `StageMove.note` is the
  hand-over comment (applied to every hop of one submission) and `StageMovePhoto`
  holds uploaded proof-of-condition images. The moves response returns `photoMoveId`
  — the hop the pieces landed on — and the client posts the files to
  `POST /moves/:id/photos` right after. There is deliberately **no challan model**;
  don't reintroduce one.
- Guards worth preserving: only the newest movement of a line can be undone; a line's
  stage line cannot change once pieces have moved; order qty cannot drop below
  `wip + done`; `PUT /orders/:id` PATCHES lines by id (never wipe-and-rebuild, that
  would destroy history). Order status auto-advances Confirmed → Production → Ready
  (`impliedOrderStatus`); Shipped/Closed/Cancelled stay human decisions.
- `OperationSheet` is now just a numbered **material sheet** (costing explosion for a
  product × qty). It holds no progress.

## Money — derived, not typed

`server/src/lib/finance.ts` is the accounting core; `orderMoney()` in
`lib/orderBoard.ts` and the `/finance/*` routes build on it. Two rules hold
everywhere:

**1. Nothing the system can work out is entered by hand.**
- **buyer receivable** = order value − receipts. `Order.exchangeRate` (snapshotted at
  creation) converts to rupees for totals.
- **jobwork payable** = board-accrued jobwork − payments. `jobworkEvents()` turns each
  clearance out of a vendor stage into a dated earning (pieces × that stage's rate),
  so a vendor's total is explained movement by movement. Pieces rejected and re-done
  earn again — the work was done again — which is why events count movements, not
  distinct pieces, and why they reconcile with the board's `cleared` figure. That
  reconciliation is the invariant to test.
- **material / wages** are the only manually-billed amounts. A `StockTxn` may be
  billed once (`LedgerEntry.stockTxnId @unique`), which keeps "what arrived" and "what
  they charged" separate without ever double-counting; un-billed deliveries are
  surfaced on the supplier statement.
- Therefore `BUYER` and `JOBWORK` rows may only be `PAYMENT`; posting a `BILL` for
  either is refused. Cancelled orders drop out of every total.

**2. Allocation is COMPUTED, never stored.** `allocateFifo()` spreads payments across
what is outstanding, oldest first: a payment settles the order it names, then the
surplus rolls on to the next oldest debt, and anything still left over is **credit on
account** rather than a negative balance. Because it is a pure function of (buckets,
payments) recomputed on every read, a later order automatically soaks up an existing
credit and nothing can go stale — there is deliberately no allocation table. Buyer
buckets are partitioned by currency so a receipt never crosses currencies.

**One shared context.** `buildFinanceContext()` allocates every payment once and
indexes the result by order; `orderMoney()` reads from it. Never recompute an order's
position from `order.ledger` alone — a row's `orderId` is only where a payment was
*aimed*, not where FIFO landed it, so doing so makes the order page and the Payments
page disagree. `financeContextFor()` loads what is needed; `serializeOrders()` shares
one context across a list.

Statements: `/finance/statement?partyType=…&partyId=…` returns a running balance plus
the detail behind every charge and how each payment was split. **A statement row
settles only the *allocated* part of a payment** — money on account is not a reduction
of any debt — which is what makes the closing balance equal the summary balance.
Overpayment to a party shows as "paid in advance" and is clamped out of the payable
total rather than offsetting real debts.

Endpoints: `/finance/receivables` (per order + buyer credits), `/finance/payables`
(per party, per-job breakdown), `/finance/parties` (index), `/finance/statement`,
`/finance/summary`. `financeTotals()` is shared with the dashboard so the two can
never disagree.

## Proforma → order

Accepting a PI is the only thing that creates an order (`POST /proformas/:id/accept`,
one order per PI, enforced server-side); the client confirms first. Rejecting records
the reason and stops. `POST .../reopen` puts it back to Draft to revise and re-send.

## Documents & e-mail

- The proforma PDF is generated server-side with **pdfkit**
  (`server/src/lib/docPdf.ts`), product photos included. `collect()` must be called
  *before* drawing and `finish()` after — calling `doc.end()` early truncates the file.
  Standard PDF fonts are WinAnsi-only, so all text goes through `safe()` and money is
  printed as a currency **code** (`USD 1,200.00`), never a symbol.
- **`mailto:` cannot attach a file** — the URI scheme has no attachment field and no
  client accepts one. So Send offers both: a `mailto:` link (subject + body) *and* a
  `.eml` download (`server/src/lib/mailDraft.ts`) carrying To/Subject/Body plus the PI
  PDF as a base64 MIME part. `X-Unsent: 1` makes Outlook/Windows Mail open it as an
  editable draft. Don't "fix" this by trying to attach via mailto.
- Downloads go through axios as a blob (`fetchDocument` in `client/src/api/ops.ts`) so
  the bearer token is sent; server errors arrive as a Blob and are unwrapped there.

## Conventions

- SQLite has no Prisma enums — enum-like fields are `String` validated with zod in routes.
- `nextDocNumber(key, tx?)` — **pass the caller's `tx` when already inside
  `$transaction`.** A nested transaction deadlocks: SQLite serialises writes, so the
  inner one can never start until the outer commits (it times out after 5 s).
- Uploads (product images and hand-over photos) share `server/uploads`, served at
  `/uploads`. Hand-over photos are named `move-*` so the two are distinguishable on
  disk; deleting a movement unlinks its files as well as its rows.
- Product create uses Prisma *unchecked* input: scalar FKs (`productTypeId`, `createdById`, …)
  + nested child creates. Do NOT mix a scalar FK with a relation `connect` in one create.
- Product update **replaces** buyers / related / cost sheet in a transaction.
- Money uses `Float` + rounding at the API boundary (`round()`), base currency INR.

## Commands

```bash
npm install
npm run db:setup     # prisma db push + seed
npm run dev          # server :4000 + client :5173
npm run build        # type-check + build both (run before declaring done)
```

```bash
npm run verify       # DB-free self-checks — run these before declaring done
npm run db:demo      # rebuild the investor demo (wipes operational data first)
```

`prisma/verify.ts` holds the invariants as pure-function assertions with fixed inputs:
the example.xlsx FOB (₹19,180.60), board conservation, the move rules, hop expansion,
jobwork reconciliation and FIFO allocation. It needs no database, so it survives any
wipe — **this is now the authority for the costing formulas**, not a seeded product.
Add a case here whenever you touch `costing.ts`, `production.ts` or `finance.ts`.

`prisma/demoSeed.ts` builds a whole factory mid-season — 10 photographed products
with real costing, three buyers in GBP/USD/EUR, proformas at every stage of the sales
cycle, four orders at different points of production (mid-line outsourcing, a QC
rejection, hand-over photos), and a money position that demonstrates FIFO settlement
and credit on account. Photos live in `prisma/demo/assets/` (web-sized, tracked) and
are copied into `uploads/` on seed, exactly as an upload would be. It clears
operational data first but leaves configuration alone, so it is safe to re-run.

`npm run build` runs `prisma generate`, which on Windows fails with `EPERM … rename
query_engine-windows.dll.node` while a dev server holds the engine — stop `npm run dev`
first. The seed is idempotent: it leaves the demo product `AB-00123` alone once it
exists, so re-running it never wipes orders that reference it.

Type-check without building: `npx tsc --noEmit -p server/tsconfig.json` and
`npx tsc --noEmit -p client/tsconfig.json`.
