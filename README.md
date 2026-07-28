# Saraswati Export — ERP

A modular ERP for **Saraswati Export**, a furniture and hardware exporter in Jodhpur.

Three modules are live:

| Module | State |
|---|---|
| **Product Management** — products, multi-method costing, images | ✅ live |
| **Operations** — proformas, orders, production board, accounting | ✅ live |
| **Manforce** — workers, muster roll, wages, advances, statutory dues | ✅ live |
| Finished Product & Sales *(container planning)* | planned |

Product data feeds Operations: a product's costing drives quoted prices and its
material sheets, and its stage line drives how pieces travel the factory floor.
Manforce closes the loop: a worker named on a stage hand-over earns for it, and what
the workforce is owed joins the same payables view as vendors and suppliers.

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | React + Vite + TypeScript + Ant Design |
| Backend | Node + Express + TypeScript |
| ORM / DB | Prisma → **SQLite** (swap `provider` to `postgresql` to scale) |
| Auth | JWT + bcrypt, roles Admin / Manager / Operator / Viewer |
| PDFs | pdfkit, server-side |

## Getting started

```bash
npm install          # installs both workspaces
npm run db:setup     # create the database + seed masters
npm run dev          # API on :4000, app on :5173
```

Open **http://localhost:5173**.

To see the whole system populated — a catalogue with photographs, orders part-way
through production, and a full set of accounts — load the demo instead:

```bash
npm run db:demo      # replaces operational data with a worked example
```

**Logins**

| Role | Email | Password |
|---|---|---|
| Admin | admin@saraswati.local | admin123 |
| Manager | manager@saraswati.local | manager123 |

## Product Management

- **Product Catalogue** — every product at a glance with Ex-Factory / FOB / Non-FOB.
- **Product Details** — filterable grid (type, size, colour, material, buyer) plus a
  detail page per product.
- **Create / Edit wizard** — product detail (unique factory code, classification,
  buyers with their own article codes, dimensions, differentiated volumes before and
  after packing, and the production stage line), costing sheet, related products,
  images.

### Costing engine

Each cost line produces a *measure* from its method, times a *rate*:

| Method | Measure |
|---|---|
| CFT | L×W×H (in) ÷ 1728 × qty |
| SQFT | L×W (in) ÷ 144 × qty |
| SQMT | L×W (cm) ÷ 10000 × qty |
| RFT | L (in) ÷ 12 × qty |
| WEIGHT | weight × (1 + wastage%) × qty |
| QTY | qty |

```
Ex-Factory = Main + Sub + Hardware + Polishing + Packaging + Labour   (excl. Forwarding)
FOB        = Ex-Factory + Forwarding + FactoryExpense% + Margin%      (cumulative)
Non-FOB    = Ex-Factory + FactoryExpense% + Margin%                   (Forwarding removed)
```

Verified to the rupee against `example.xlsx` (the "Crazy Almirah", FOB ₹19,180.60) —
and kept that way by `npm run verify`, which asserts the figure without needing any
database state.

**Formulas are editable.** Methods live in Master Data → *Cost Formulas*: a free-form
expression over `L W H AL AW AH QTY WASTAGE WEIGHT`, testable before saving.

**Exchange rates.** Base currency is INR. The ICEGATE customs page is CAPTCHA-
protected, so Master Data → *Currencies* → **Import export rates (ICEGATE)** lets you
solve the CAPTCHA yourself, paste the table, and it reads the Export column.

## Operations

The factory flow: **proforma → accepted → order → pieces move through stages → jobwork
and receipts settle.**

### Proforma

Build a PI, print product photographs on it, and send it. Sending offers two routes,
because `mailto:` links cannot carry a file: a plain mail link with subject and body,
or a **`.eml` draft with the PI PDF already attached** that opens in Outlook or
Windows Mail ready to send.

The buyer's answer is recorded, and **accepting is the only thing that creates an
order** — one per proforma, confirmed first. Rejecting stores the reason and stops;
either way the PI can be reopened, revised and re-sent.

### The production board

**Stage lines** (Master Data → *Stage Lines*) are named routes, e.g.

```
X  Raw joining → Raw sanding → Polishing → Accessory fitting → QC → Packaging
Y  Raw joining → Powder coating → Fitting → QC → Packing
```

A product is assigned one. Every order line takes its **own copy** of the steps, so
editing a stage line later never rewrites orders already running.

Each line shows one strip — *Not started → every stage → Finished* — with the number
of pieces sitting in each. Click a bucket to pass pieces on; you choose only where
they are and where they are going, and the action (cleared / sent back / finished) is
derived, so an illegal move cannot be expressed. Every hand-over carries a **note and
photographs**. Rejections move pieces backwards for rework.

Where pieces are is **derived** from an append-only movement ledger, never stored, so
the board can never disagree with its own history. Any movement can be undone,
newest first.

**Outsourcing is per stage**, so any pattern works — stages 1–3 in-house, 4 at a
vendor, 5–6 in-house again. Clearing several stages at once records one hop per stage,
keeping each stage's count, and the jobwork owed on it, exact.

### Money

Nothing the system can work out is ever typed in:

- **A buyer owes** their order value, less receipts.
- **A jobwork vendor earns** the pieces they cleared × the rate on that stage,
  recorded as a dated event per clearance. Pieces rejected and re-done earn again,
  and are labelled as such.
- **Only material bills and wages** are entered by hand, because nothing else knows
  them. A stock receipt can be billed once, keeping "what arrived" and "what they
  charged" separate without double-counting.

**Payments settle oldest-first.** A payment clears the order it names, then any
surplus rolls on to the next oldest debt; anything still left over is held as *credit
on account* and settles the next order automatically. Allocation is computed on every
read rather than stored, so it can never go stale.

Every party — buyer, jobwork vendor, material supplier, worker — has a running
**statement** showing what created each charge, what settled it, and how each payment
was split.

## Manforce

**Nobody is on a pay cycle.** The factory pays people when it pays them — a worker may
draw an advance, or go two months without a payment — so a worker is a running
**account**, exactly like a jobwork vendor. Earnings accrue as dated events, payments
are ad-hoc for any amount on any date, and there is no period to close, so nothing can
ever be late or half-run.

**Nothing that can be worked out is typed in.** A worker's earnings are
(working days x their rate) + (overtime hours x OT rate) + (pieces cleared x that
stage's labour rate). No wage table, no balance column, no stored day count — which is
why adding a festival to the holiday calendar, even a past one, corrects the money
immediately instead of leaving a wrong number behind.

**Attendance is exceptions-only.** Every active worker is presumed present on every
working day; a row exists only to say otherwise, or to pay someone who came in on a
day off. An untouched muster is already a full day's attendance. Which days count is
the Admin's decision (weekly offs plus a holiday calendar), not a hard-coded rule.

Three pay types coexist, one per worker: **daily wage** (rate x days present, plus
overtime), **piece rate** (earned on the board, so attendance never pays them), and
**monthly salary** (accrued pro-rata across the month's working days, never as a lump,
so the balance is right mid-month too).

**Who did the work is recorded on the hand-over.** A clearance out of an in-house
stage may name workers with a piece count each, which must add up to the pieces that
moved — so every rupee is attributable and the total still reconciles with the board's
`cleared` figure. A clearance crossing several stages cannot say who did which, and is
refused rather than guessed at. Rates come from the order's own stage
(`OrderLineStage.labourRate`), defaulted from the product's LABOUR cost lines, which
are reference only.

**Contractors are paid, not their gangs.** A worker may belong to a labour contractor;
their earnings then roll up into the contractor's balance with the per-worker
breakdown behind it, and paying the worker directly is refused — otherwise the same
wages would be owed twice.

**Advances are recovered from earnings.** An advance is cash out with a monthly
recovery cap; earnings absorb at most that much a month. Two figures come out, and
their difference is exactly the advance still outstanding:

```
balance = earned - deductions - statutory - payments - advances   (the party balance)
dueNow  = earned - deductions - statutory - payments - recovered  (cash due today)
dueNow - advanceOutstanding === balance
```

A cap of zero means "absorb as fast as they earn", which makes an advance behave
exactly like a payment that outran the wages. The identity above is asserted in
`npm run verify`.

**Statutory dues are data, and are incurred when you say so.** PF, ESI, professional
tax and statutory bonus ship as *editable* components — employee %, employer %, what
they apply to, contribution and eligibility ceilings — the same approach as the cost
formulas, so a change in the law is an edit rather than a release. A period's liability
is computed from the wages actually earned in it and shown as a preview; **nothing is
owed to anyone until it is posted.** Posting deducts the employee share from each
worker and raises the total as a payable; two postings may not overlap for the same
levy. A component marked as a *provision* accrues as a cost but is never counted as a
debt.

Workers, contractors and statutory levies appear in the same **payables** view and
dashboard total as vendors and suppliers, each with a running statement.

## What the app remembers

Beside a rate, a price or a wage, the app shows what it was **last time** — and where
that figure came from.

Ask about `CARVING LABOUR` and it answers with more than one fact, because more than one
is relevant:

- **Costed before** — the same line in other products, with the product and the date.
- **A supplier billed** — for a material line, what was actually paid for that item, so
  the gap between the costed ₹560/CFT and the real ₹612/CFT is visible at the moment you
  are typing.
- **Vendors charged / in-house piece rate** — for a labour line mapped to a production
  stage, what that stage has really paid out.
- **This buyer paid** — on a proforma or order line, what they last paid for the product,
  then every buyer's range, always in the same currency.

Each source is shown separately and never averaged together, because they are different
facts. One click fills the field in.

**Nothing is stored to make this work.** Every figure is read from the live records when
asked, so a correction to the original shows up immediately and there is no second copy
to go stale. Names are matched ignoring case and spacing, so `CARVING LABOUR` and
`Carving Labour` are one item. History reaches back a year by default — Master Data →
**Memory** sets the window.

**A figure well out of line gets a quiet amber note** — "917% above the average of 9 past
uses" — never a block. It only appears once there are at least two past uses to compare
with, so it does not cry wolf on a new item. The tolerance is 25% by default.

**Separately, every change to a rate, price or wage is recorded** — who changed it, what
it was before, and when — on the **History** tab of the product, order or worker it
belongs to. That is the one thing the suggestions cannot tell you, because an edit
overwrites the old value. Only figures are logged, so the list stays readable; a save
that changed nothing records nothing.

## Project layout

```
server/
  prisma/schema.prisma     data model
  prisma/seed.ts           masters + the example.xlsx product
  prisma/demoSeed.ts       the worked demo (npm run db:demo)
  prisma/manforceSeed.ts   trades, levies + the migration off typed wage names
  prisma/verify.ts         self-checks (npm run verify)
  src/lib/costing.ts       costing engine  (mirrored in client/src/util)
  src/lib/production.ts    the board: movement ledger -> buckets
  src/lib/finance.ts       FIFO allocation, jobwork events, statements
  src/lib/workforce.ts     attendance -> wages, piece work, advances, statutory
  src/lib/manforce.ts      loads the above into positions and statements
  src/lib/suggest.ts       "what did we use last time" — derived, never stored
  src/lib/changeLog.ts     who changed which figure, and what it was
  src/lib/docPdf.ts        proforma PDF
  src/lib/mailDraft.ts     .eml draft with attachment
client/
  src/pages/operations/    proformas, orders, board, payments, statements
  src/pages/product/       catalogue, details, wizard
  src/pages/manforce/      workers, muster roll, wages, statutory
  src/components/HistoryHint.tsx   the "last time" marker beside a figure
server/uploads/            product images, hand-over photos, worker documents (git-ignored)
```

## Scripts

```bash
npm run dev              # both apps
npm run verify           # costing, board, allocation and workforce self-checks
npm run db:setup         # push schema + seed masters
npm run db:demo          # load the worked demo
npm run db:workers       # turn typed wage names into worker records (idempotent)
npm run build            # type-check + build both apps
npm --workspace server run db:studio   # browse the database
```

`npm run build` runs `prisma generate`, which on Windows cannot replace its query
engine while a dev server is holding it — stop `npm run dev` first.

## Security

- **`JWT_SECRET` is required in production** and rejected if it is a placeholder or
  under 32 characters. In development, leaving it blank generates a random secret per
  boot rather than falling back to a value committed in the source.
- **CORS is an allowlist**, not `*`. Development defaults to the Vite dev server;
  production reads `CORS_ORIGINS`.
- **Uploads are not public.** Product photos and hand-over shots sit behind the same
  authentication as the API. Because an `<img>` tag cannot send an Authorization
  header, login also issues an httpOnly session cookie used only for `/uploads`, and
  files are served with `nosniff` and a restrictive CSP.
- **Uploads are checked by content, not by their declared type.** A file's magic bytes
  must really be JPEG, PNG, GIF or WebP; anything else is deleted on arrival, so a
  renamed script cannot be parked in a directory the browser fetches from.
- **Sign-in attempts are throttled** per IP and e-mail.
- **Document numbers are allocated atomically**, so simultaneous order or proforma
  creation cannot mint the same number twice.
- **Piece movements are validated inside the write transaction**, so two clearances of
  the same pieces cannot both succeed.
- Anyone can rotate their own password from the account menu; the last active Admin
  cannot be demoted, deactivated or deleted.
- `npm run verify` and the delete guards throughout are there to keep these true —
  run it before shipping.

Copy `server/.env.example` to `server/.env` before deploying.

## Notes and limits

- **Stock is deliberately decoupled from production.** Material sheets say what a job
  needs, but issuing pieces does not consume raw material; stock movements are
  recorded separately. Reconciling the two is not yet automatic.
- **Wages recorded before Manforce stay against a typed name** until `npm run db:workers`
  turns them into worker records. Such a worker's `accrualFrom` is set to the day after
  their last hand-typed entry, so the engine never invents presumed-present days for a
  period that was already paid by hand.
- **In-house labour is not attributed to an order's cost.** Worker money is a
  factory-level account by design; the board records who did the work, but the cost per
  order still counts only jobwork and material.
- **A bulk stage clearance names nobody**, so it accrues no piece wages. Use a single
  bucket on the board to record who did the work.
- **Receivables convert at the rate snapshotted on the order**, not today's rate.
- **Money is stored as `Float`** and rounded at every boundary by a shared `round()`
  helper (mirrored on the client, asserted in `npm run verify`). Exact decimal storage
  would mean integer paisa throughout; the rounding discipline is what holds the
  totals together today.
- **The login token lives in `localStorage`**, which is readable by any script on the
  page. The defence is that there is no way to get a script onto the page: uploads are
  content-checked and served with `nosniff`. Moving to a cookie-only session would
  need CSRF protection across every mutating route.
- `mailto:` cannot attach a file — that is a limit of the URI scheme, not a bug; the
  `.eml` draft exists for exactly this reason.
