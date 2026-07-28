# Saraswati Export — ERP

A modular ERP for **Saraswati Export**, a furniture and hardware exporter in Jodhpur.

Two modules are live:

| Module | State |
|---|---|
| **Product Management** — products, multi-method costing, images | ✅ live |
| **Operations** — proformas, orders, production board, accounting | ✅ live |
| Manforce Management | planned |
| Finished Product & Sales *(container planning)* | planned |

Product data feeds Operations: a product's costing drives quoted prices and its
material sheets, and its stage line drives how pieces travel the factory floor.

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

## Project layout

```
server/
  prisma/schema.prisma     data model
  prisma/seed.ts           masters + the example.xlsx product
  prisma/demoSeed.ts       the worked demo (npm run db:demo)
  prisma/verify.ts         self-checks (npm run verify)
  src/lib/costing.ts       costing engine  (mirrored in client/src/util)
  src/lib/production.ts    the board: movement ledger -> buckets
  src/lib/finance.ts       FIFO allocation, jobwork events, statements
  src/lib/docPdf.ts        proforma PDF
  src/lib/mailDraft.ts     .eml draft with attachment
client/
  src/pages/operations/    proformas, orders, board, payments, statements
  src/pages/product/       catalogue, details, wizard
server/uploads/            product images + hand-over photos (git-ignored)
```

## Scripts

```bash
npm run dev              # both apps
npm run verify           # costing, board and allocation self-checks
npm run db:setup         # push schema + seed masters
npm run db:demo          # load the worked demo
npm run build            # type-check + build both apps
npm --workspace server run db:studio   # browse the database
```

`npm run build` runs `prisma generate`, which on Windows cannot replace its query
engine while a dev server is holding it — stop `npm run dev` first.

## Notes and limits

- **Stock is deliberately decoupled from production.** Material sheets say what a job
  needs, but issuing pieces does not consume raw material; stock movements are
  recorded separately. Reconciling the two is not yet automatic.
- **Wages are recorded against a typed worker name** until the Manforce module lands,
  so a spelling change starts a new account.
- **Receivables convert at the rate snapshotted on the order**, not today's rate.
- `mailto:` cannot attach a file — that is a limit of the URI scheme, not a bug; the
  `.eml` draft exists for exactly this reason.
