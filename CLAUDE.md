# CLAUDE.md — Saraswati Export ERP

Guidance for working in this repo.

## What this is

Modular ERP for Saraswati Export (furniture/hardware exporter). **Phase 1 =
Product Management**, **Phase 2 = Operations** (proformas → orders → production
board → payments), **Phase 3 = Manforce** (workers → muster → wages → statutory).
Sales is still a placeholder that routes to `PlaceholderModule`. Product data
(costing, dimensions, differentiated volumes) feeds Operations; the Operations board
feeds Manforce; Sales (container planning) comes later.

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

## Manforce — a worker is a running account

**There are no pay periods.** The factory pays people when it pays them: a worker may
draw an advance or go unpaid for two months. So a worker is an account like a jobwork
vendor — earnings accrue as dated events, payments are ad-hoc, nothing is ever "run" or
closed. Do not add a payroll-period model; it would be wrong on day one.

- `server/src/lib/workforce.ts` is the **pure engine** (no DB) and
  `server/src/lib/manforce.ts` is the **seam** that loads data into it — the same split
  as `production.ts` / `orderBoard.ts`. Nothing derivable is stored: no wage table, no
  balance column, no day count.
- **Attendance is exceptions-only.** Every active worker is presumed present on a
  working day; a row exists only to say otherwise (or to pay someone on a day off).
  Which days count is Admin config (`WorkforceSetting.weeklyOffDays` + `Holiday`), and
  `presumePresent` can switch the presumption off. Adding a holiday RESTATES past
  accrual, which is the point of deriving it.
- **Pay type decides which accrual applies** — DAY (rate × days), PIECE (board only,
  so attendance can never double-pay), MONTHLY (pro-rata per working day, never a
  lump). `monthlyPerDay()` honours the Admin's divisor; WORKING is exact, the FIXED_*
  bases are conventional and documented as such.
- **`Worker.accrualFrom` exists to stop double-paying history.** Wages used to be typed
  against a name; a migrated worker starts accruing after their last manual entry.
  Never default it to `joinedOn` for a migrated worker.
- **Two figures, one identity.** `balance` = earned − deductions − statutory −
  payments − advances (the party balance, used everywhere). `dueNow` is the same but with
  advance *recovery* in place of the advance, honouring each advance's monthly cap.
  `dueNow − advanceOutstanding === balance` — asserted in `verify.ts`. Break that and the
  worker page and the payables page start disagreeing.
- **Advance cash is ONE ledger row** (`LedgerEntry.advanceId @unique`, the same pattern
  as `stockTxnId`). `WorkerAdvance` holds only the recovery terms. Deleting the payment
  alone is refused; delete the advance and the cash goes with it.
- **Piece work comes off the board.** `StageMoveWorker` names who cleared a stage with a
  piece count each, which must sum to the movement's qty (`validateMoveWorkers`,
  mirrored in `client/src/pages/operations/board/moveLogic.ts` — **keep those in sync**).
  Priced at the stage's current `OrderLineStage.labourRate`, exactly as vendor jobwork is
  priced, so rework earns again and the totals reconcile with the board's `cleared`
  figure. `clearances()` in `production.ts` is the ONE walk over the move ledger that
  both `jobworkEvents` and `labourEvents` are built on — do not fork it.
- **Only a single-hop clearance can be attributed.** A move spanning several stages is
  refused rather than guessed at, because each hop is a different stage's work. A vendor
  stage refuses workers, and an in-house stage with workers named requires a rate (a zero
  rate elsewhere is normal — that stage is day-wage work).
- **Product LABOUR lines are REFERENCE only.** `CostLine.stageStepId` maps a labour line
  to a step of the product's stage line; `labourRatesForProduct()` seeds
  `OrderLineStage.labourRate` when an order snapshots its stages. Costing itself never
  reads it — the roll-up and the example.xlsx FOB must stay byte-identical.
- **Contractors are paid, gangs are not.** `Worker.contractorId` set = their earnings
  roll into the contractor's balance, and paying the worker directly is refused. A gang
  member is deliberately NOT a payable row of their own, or the money would count twice.
- **Statutory is admin-defined data** (`StatutoryComponent`, seeded from
  `BUILTIN_STATUTORY` exactly as `BUILTIN_METHODS` seeds cost formulas) and is incurred
  **only when posted**. `StatutoryPostingLine` stores the wage base it used, because the
  earnings behind it can legitimately be restated later and a posted liability must not
  move. Overlapping periods for one component are refused. `isProvision` accrues a cost
  that is never a payable.
- **Worker money stays out of order costing** (a deliberate decision) but workers,
  contractors and levies DO appear in `/finance/payables`, `/finance/parties`,
  `/finance/statement` and the dashboard total.
- **Dates are calendar facts.** Always go through `dayStart` / `dayKey` / `monthKey`.
  `toISOString().slice(0,10)` on a local midnight names the day BEFORE east of UTC and
  would shift a whole muster or statutory period; `verify.ts` guards this.
- RBAC: Operator marks the muster, Manager+ for workers, rates, money and postings.
  Identity and bank fields are redacted below Manager (`redact()` in the routes).

## Remembering figures — suggestions vs the change log

Two different questions, answered by two deliberately different mechanisms. Do not
merge them.

**"What did we use last time?" is DERIVED, never stored.** `server/src/lib/suggest.ts`
holds the pure maths and `routes/suggest.routes.ts` reads it out of the live records —
cost sheets, stock receipts, stage rates, orders and proformas — on every request.
There is no price-memory table on purpose: a stored copy would drift the moment
somebody corrected the original, and the correction is exactly what you want to see.

- **Matching is by name, case- and space-insensitive** (`normalizeKey`). `CARVING
  LABOUR`, `Carving Labour` and `carving  labour` are one item, because that is how the
  sheets were actually typed. Nothing cleverer — fuzzy matching would silently merge
  two genuinely different lines.
- **Sources are kept SEPARATE, never averaged.** What a line was *costed* at and what a
  supplier actually *billed* are different facts and the gap between them is the
  interesting part. `assemble()` orders them most-comparable first and drops the empty
  ones so the UI never shows a heading with nothing under it.
- Everything relative is connected: a cost line reaches its own history in other
  products, the **supplier receipts** for the matching raw item (matched on the GROUP
  name, which is the material), and — when the line is mapped to a stage — what
  **vendors charged** and **workers earned** for that stage. A product line on a
  proforma or order reaches what that buyer, then any buyer, paid in the same currency.
- **The window is a hard cut-off** (`AppSetting.suggestionWindowDays`, 365). Older
  figures are not shown at all — a two-year-old rate is worse than no rate. A cost
  sheet's date is its `createdAt`, because saving a product REPLACES the sheet, which
  makes it the moment those rates were set.
- **`outlier()` compares against the window's AVERAGE, not the last value**, and stays
  silent below two past uses — one previous use is not a pattern. It never blocks; it is
  a note beside a field to catch ₹2,600 typed for ₹260. `outlierOf()` in
  `client/src/api/suggest.ts` mirrors it so the note updates as you type — **keep the
  two in step.**
- The costing wizard asks **once for the whole sheet** (`POST /suggest/cost-lines`).
  Forty fields asking individually would be forty round-trips.

**"Who changed this, and what was it?" is STORED, because nothing else can reconstruct
it** — an edit destroys the old value. `server/src/lib/changeLog.ts`, surfaced as a
History tab on the product, order and worker.

- **Only money and rates are logged.** A log of every keystroke would bury the one entry
  anybody ever needs.
- `rootType`/`rootId` is the record a person would *open* to look. A cost line's own id
  is useless for that, because saving a product replaces the whole sheet — so a rate
  change is logged against the **product**.
- `diffCostSheet()` must run **BEFORE** the sheet is replaced, or the old rates are
  already gone. Lines are matched on group + line name, the same key suggestions use.
- `differs()` ignores sub-paisa differences, which are rounding, not edits — so a save
  that changed nothing logs nothing.
- `wipeOperational()` in the demo seed clears the log FIRST: rows point at records by
  id, and left behind they would resurface on whichever new record reuses that id.

## Markets and channels — four workflows, two axes

A buyer carries TWO independent settings, so all four combinations exist and none of them
is a special case: `Buyer.channel` (B2B | B2C) and `Buyer.market` (OVERSEAS | DOMESTIC).
An overseas importer, a domestic dealer, a domestic walk-in and a web order from abroad
are the same machinery with different data. Existing buyers are OVERSEAS + B2B, which is
all the app supported before.

`market` is the one that changes behaviour:

| | Overseas | Domestic |
|---|---|---|
| Price basis | **FOB** in the buyer's currency | **Non-FOB** in rupees (no CHA / forwarder / ICD) |
| Tax | zero-rated, every rate on the document ignored | GST, split CGST+SGST or IGST |
| Numbering | `PI-` / `ORD-` | `DPI-` / `DORD-` |
| Document | Proforma Invoice | Quotation |
| Incoterms | yes | hidden — an export concept |

`channel` records who they are; it drives no arithmetic. B2C simply has no GSTIN, which
the buyer form allows and the document handles.

## Document money — one engine, three readers

`server/src/lib/pricing.ts` is the **single authority for what a proforma or an order is
worth**, mirrored exactly in `client/src/util/pricing.ts` (keep them identical, like
costing.ts and expr.ts). It exists because three separate places used to add up
`qty × unitPrice` independently — `serializeOrder`, the FIFO buckets in
`buildFinanceContext`, and `orderValue()` on the dashboard. Once a line can carry a
discount and a document can carry freight and GST, three copies of that sum would
disagree the moment one was missed, and the order page and the Payments page would tell
the buyer two different things. **Everything goes through `documentValueOf()`.**

The rules, in the order they apply:

1. A **line** is `qty × unitPrice`, less its discount percentage, then its flat amount, and
   never below zero. Percentage first, because "10% off and another ₹500 off" is how it is
   said out loud.
2. A **charge** belongs to the whole document and carries its OWN gst rate rather than
   being apportioned across the lines — that is how an invoice really bills freight, and
   apportioning would make the tax on one line depend on unrelated lines. A percentage
   charge is a percentage of the **line subtotal only**, so charges never compound and the
   order they were entered in cannot change the total. Amounts are stored positive;
   `kind` (CHARGE | DISCOUNT) carries the sign, so a negative number typed against a
   discount cannot flip it back into a charge.
3. **Tax** applies per rate, one row per slab, so a document with 12% and 18% goods
   summarises correctly. `isTaxable` false is for something added after tax (a round-off).
4. **CGST+SGST versus IGST is DERIVED** by comparing the buyer's state with the company's
   (`Company.state`, Master Data → Company) — never typed, so it cannot contradict the
   addresses on the document. `sameState()` treats an unknown state as **not** a match, so
   an unconfigured company charges IGST rather than silently under-collecting. The halves
   are split off the *rounded* slab total, which is what keeps `CGST + SGST === taxTotal`.
5. An **overseas document is zero-rated end to end**: every rate on it is ignored rather
   than trusted, so a stray 18% left on a line can never tax an export.

A domestic buyer is refused without a state, because the split would otherwise be wrong
silently. Accepting a proforma **copies** its charges and line discounts onto the order
(not references them), so the order stays worth what was quoted even if the PI is later
revised — and a PI carrying charges refuses to become an order if any line is unlinked,
since freight would then be billed on goods that did not come across.

## Nothing is destroyed — soft delete

`Product`, `Order`, `Proforma`, `LedgerEntry` and `OperationSheet` carry `deletedAt`.
`DELETE` sets it; the row survives and can be restored from the Trash drawer on the list
page. Two rules keep it safe:

- **Filtering happens at the QUERY layer, never in the pure functions**
  (`server/src/lib/softDelete.ts`). The costing, board, workforce and pricing engines know
  nothing about deletion — a deleted order leaves the money picture the way a *cancelled*
  one does, because the query excludes it. `verify.ts` asserts this by passing a
  soft-deleted order to `buildFinanceContext` and checking it is still priced: if someone
  ever "helpfully" teaches the engine about `deletedAt`, that check fails and says why.
  `LIVE_ORDER` is now `{ status: not Cancelled, deletedAt: null }` — one place, both rules.
- **Master data is NOT soft-deletable.** Currencies, units, buyers, suppliers and the rest
  already have `isActive`, which does the same job. A second mechanism would mean two ways
  to hide one row.

A permanent delete exists, is **Admin-only**, works only from the trash, and has **no
waiting period and no automatic purge** — nothing disappears because time passed. The
product "in use" check is now ADVISORY on soft delete (the orders referencing it are
unaffected) and BLOCKING on permanent delete, where the foreign keys really bite.

**Express matches routes in registration order**, so every literal path — `/trash`,
`/orders/delivery-status` — must be registered BEFORE the `/:id` route that would
otherwise swallow it and hand the handler `Number('trash')`.

## Attachments — paperwork on an order

`OrderAttachment` holds the buyer's PO, bills of lading, customs forms, packing lists,
inspection certificates and drawings. `server/src/lib/documentUpload.ts` mirrors the
discipline of `imageUpload.ts`: an extension allow-list, then the **magic bytes** are
checked and anything whose contents contradict its name is unlinked before a row can point
at it. Two limits are documented rather than pretended away — `.docx`/`.xlsx`/`.zip` share
the `PK` signature so only the extension distinguishes them, and `.txt`/`.csv`/`.eml` have
no signature at all, so they are only checked for being NUL-free text. 25 MB per file.

Downloads go through `GET /orders/:id/attachments/:attachmentId`, **scoped to the order in
the path** so one order's id cannot fetch another's file, and always
`Content-Disposition: attachment` with `nosniff` — an arbitrary document must download,
never render. Removing an attachment is a hard delete: a file has no history worth keeping,
and orphaned bytes in `uploads` would be worse.

## Scheduling — an overlay, never a replacement

`server/src/lib/scheduling.ts` is pure and produces **no quantities whatsoever**. The
board's invariant is untouched: `StageMove` still says where pieces ARE.

- `OrderLineSchedule` + `StageSchedule` hold estimated start/end per stage.
  `StageLineStep.defaultDays` (Master Data → Stage Lines) is what makes `autoSchedule()`
  believable — stated once, it lays an order out backwards from its delivery date and
  gives every stage at least a day, scaling the durations rather than overrunning the
  deadline.
- `estimateCompletion()` compares the plan with the board: DONE / AHEAD / IN_PROGRESS /
  OVERDUE / NOT_STARTED per stage. **Progress always comes from the board**, never from the
  schedule.
- `deliveryStatus()` is derived on every read, so it can never be stale. AT_RISK is the
  only judgement call: inside the last `AT_RISK_DAYS` (7) with less than `AT_RISK_PCT`
  (80%) finished. Far out, a slow start is normal and is deliberately not flagged.
- `Order.expectedDelivery` is the factory's own estimate, distinct from `deliveryDate`
  which is what the buyer asked for. Comparing the two is the point.

## Multi-currency receivables

`receivablesByCurrency()` in `finance.ts` groups what is outstanding by currency and values
it twice — at the rate each order was booked at (`Order.exchangeRate`) and at today's from
the currency master. The gap is **unrealised** forex: nothing is booked until the money
arrives, which is why it is presented as a movement rather than folded into a total. The
average booked rate is **weighted by what is outstanding**, so it is comparable with the
live rate. `/finance/receivables` carries the block and
`/finance/receivables/summary` returns it alone; both are built from the same allocated
rows, so the summary bar and the table cannot disagree.

## Proforma → order

Accepting a PI is the only thing that creates an order (`POST /proformas/:id/accept`,
one order per PI, enforced server-side); the client confirms first. Rejecting records
the reason and stops. `POST .../reopen` puts it back to Draft to revise and re-send.

## Documents & e-mail

- The proforma PDF is generated server-side with **pdfkit**
  (`server/src/lib/docPdf.ts`), product photos included. It draws its letterhead from the
  **Company** record and its money from `documentTotals()` — it never adds anything up
  itself, so it cannot print a figure the rest of the app disagrees with. A domestic
  document gains HSN and GST columns, a place of supply, the charge rows and the
  CGST/SGST/IGST breakdown, and is titled *Quotation*; an export is byte-for-byte what it
  always was. `collect()` must be called
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

## Security invariants

Undoing any of these reopens a hole that was closed deliberately:

- `env.ts` **throws** on a missing/placeholder `JWT_SECRET` in production and generates
  a random one in dev. Never reintroduce a hardcoded fallback.
- CORS is an allowlist from `CORS_ORIGINS`; `cors()` with no options is wide open.
- `/uploads` sits behind `authenticateUpload`, which accepts the bearer header **or**
  the httpOnly `saraswati_session` cookie that login sets — an `<img>` tag cannot send
  a header. The client's axios instance uses `withCredentials`. Files go out with
  `nosniff` + CSP.
- All image uploads go through `lib/imageUpload.ts`: extension allow-list, then the
  magic bytes are checked and anything that is not really an image is unlinked. A
  declared mimetype is attacker-controlled and proves nothing.
- `nextDocNumber` uses an atomic `{ increment: 1 }`. A read-then-write would let two
  callers mint the same number, because SQLite takes no lock on the read.
- `POST /orders/:id/moves` validates **inside** the write transaction; so does undo.
- Delete routes report what references a record instead of letting a foreign key
  surface as a 500 — products, buyers, suppliers, raw items, currencies, units,
  attributes, stage lines, stock receipts, users, trades, contractors, workers,
  statutory components and postings.
- Order attachments are validated by **magic bytes**, not the declared mimetype, and are
  served `Content-Disposition: attachment` with `nosniff` so a document can never render
  in the browser. A download is scoped to the order in its path.
- The company logo goes through the same image pipeline as product photos, and the
  previous file is unlinked on replace rather than orphaned.
- **Permanent delete is Admin-only** and only reachable from the trash. Soft delete is
  Manager+.
- **Worker identity and bank details are withheld below Manager** (`redact()` in
  `manforce.routes.ts`). Filtering them in the client only would still ship them over
  the wire to anyone with an Operator login.
- `round()` nudges the magnitude, not the signed value, so negatives round
  symmetrically; `client/src/util/costing.ts` mirrors it exactly.

## Conventions

- SQLite has no Prisma enums — enum-like fields are `String` validated with zod in routes.
- `nextDocNumber(key, tx?)` — **pass the caller's `tx` when already inside
  `$transaction`.** A nested transaction deadlocks: SQLite serialises writes, so the
  inner one can never start until the outer commits (it times out after 5 s).
- **`companyState()` upserts, so it is a WRITE.** Read it before opening a transaction,
  never inside one — the same deadlock, and it cost a 5-second timeout on the proforma
  save before every call site was hoisted.
- **A currency change must restate `exchangeRate`, and a buyer change the tax snapshot.**
  `PUT /orders/:id` and `PUT /proformas/:id` rewrite both. Left behind, a rupee order
  edited to USD stayed at rate 1 — booking a phantom forex gain of the whole order value —
  and a domestic order moved to another state still printed CGST + SGST on what had become
  an inter-state sale.
- Uploads (product images, hand-over photos and worker documents) share
  `server/uploads`, served at `/uploads`. Hand-over photos are named `move-*` and worker
  photos/IDs `worker-*` so they are distinguishable on disk; deleting a movement or a
  worker unlinks its files as well as its rows.
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
npm run db:fill      # same thing, named for what it does — fill the DB with examples
npm run db:clean     # clean slate: operational data to zero, doc numbering reset
npm run db:workers   # migrate typed wage names onto worker records (idempotent)
```

`prisma/verify.ts` holds the invariants as pure-function assertions with fixed inputs:
the example.xlsx FOB (₹19,180.60), board conservation, the move rules, hop expansion,
jobwork reconciliation, FIFO allocation, and the whole workforce engine — the
working-day calendar, exceptions-only accrual, pro-rata salary, piece attribution,
statutory maths and the `dueNow − advanceOutstanding === balance` identity, plus the
suggestion maths (name normalisation, which source leads, the outlier threshold), and the
document pricing (line discounts, charge signs, the GST slabs, the CGST/SGST split
reconciling to the paisa, and an export staying untaxed), the scheduling engine
(auto-scheduling from stage durations, plan-versus-board status, the delivery verdict), the
currency grouping behind the forex position, and the rule that soft delete stays OUT of the
pure functions. It needs no database, so it survives any wipe — **this is now the authority
for the costing formulas**, not a seeded product. Add a case here whenever you touch
`costing.ts`, `production.ts`, `finance.ts`, `workforce.ts`, `suggest.ts`, `pricing.ts` or
`scheduling.ts`.

`prisma/cleanSlate.ts` (`db:clean`) is the opposite of the demo seed and shares its wipe
list: every operational table to zero, uploads unlinked, and all six DocSequence
counters back to 0 so numbering restarts at 001. Configuration is deliberately kept —
logins, currencies, units, attributes, cost formulas, stage lines, trades, holidays,
workforce settings and statutory components — because that is setup, not data. **If you
add a model, add it to BOTH `wipeOperational()` and `cleanSlate.ts`**, or a wipe will
leave orphans behind that resurface on whichever new record reuses their id.

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
