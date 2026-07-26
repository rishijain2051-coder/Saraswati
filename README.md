# Saraswati Export — ERP

A modular ERP for **Saraswati Export** (furniture / hardware exporter).

**Phase 1 delivers the Product Management module** — the source of truth for
product details, multi-method costing sheets, related products and images. Its
data (costing, dimensions, differentiated volumes) is modelled to feed the later
Operations (operation sheets) and Sales (container planning) modules.

The home screen shows all five planned modules:

1. Manforce Management *(planned)*
2. Raw Material Management *(planned)*
3. **Product Management** ✅ *(live)*
4. Operations Management *(planned)*
5. Finished Product & Sales Management *(planned)*

## Tech stack

| Layer     | Choice |
|-----------|--------|
| Frontend  | React + Vite + TypeScript + Ant Design |
| Backend   | Node + Express + TypeScript |
| ORM / DB  | Prisma → **SQLite** (swap `provider` to `postgresql` to scale) |
| Auth      | JWT + bcrypt, roles: Admin / Manager / Operator / Viewer |

## Getting started

```bash
# 1. Install dependencies (root installs both workspaces)
npm install

# 2. Create the database + seed demo data (admin user, masters, example product)
npm run db:setup

# 3. Run backend (:4000) and frontend (:5173) together
npm run dev
```

Then open **http://localhost:5173**.

**Logins**

| Role    | Email                     | Password    |
|---------|---------------------------|-------------|
| Admin   | admin@saraswati.local     | admin123    |
| Manager | manager@saraswati.local   | manager123  |

## Product Management

- **Product Catalogue** — executive summary of every product (codes, class,
  buyer, Ex-Factory / FOB / Non-FOB) derived from product details.
- **Product Details** — filterable grid (type, size, colour, material, buyer)
  and a full detail page per product (details, costing sheet, related, images).
- **Create / Edit** — a 4-step wizard:
  1. **Product Detail** — factory code (unique), name, alias, classification,
     multiple buyers with their own article codes, physical dimensions and
     **differentiated volumes** (before vs after packing) for container planning.
  2. **Costing Sheet** — the 7 heads (Main / Sub Component, Hardware, Polishing,
     Packaging, Labour, Forwarding), each split into material groups that use a
     measurement **method**: CFT, SQFT, SQMT, RFT, WEIGHT or QTY. Live totals and
     FOB roll-up as you type.
  3. **Related Products** — typed links (variant / part / accessory / set).
  4. **Images** — multiple per product, one primary.

### Costing engine

Each cost line produces a *measure* (from its method) × *rate* = *amount*:

| Method | Formula |
|--------|---------|
| CFT    | L×W×H (in) ÷ 1728 × qty × rate |
| SQFT   | L×W (in) ÷ 144 × qty × rate |
| SQMT   | L×W (cm) ÷ 10000 × qty × rate |
| RFT    | L (in) ÷ 12 × qty × rate |
| WEIGHT | weight × (1 + wastage%) × qty × rate |
| QTY    | qty × rate |

Roll-up:

```
Ex-Factory = Main + Sub + Hardware + Polishing + Packaging + Labour   (excl. Forwarding)
FOB        = Ex-Factory + Forwarding + FactoryExpense% + Margin%       (cumulative)
Non-FOB    = Ex-Factory + FactoryExpense% + Margin%                    (Forwarding removed)
```

The engine is verified to the rupee against `example.xlsx` (the "Crazy Almirah",
FOB ₹19,180.60). Costing dimensions are auto-suggested from actual dimensions +
wastage %, and remain editable.

**Formulas are editable.** Methods live in Master Data → *Cost Formulas*: create
or edit a method with a free-form expression (variables `L W H AL AW AH QTY
WASTAGE WEIGHT`, operators `+ - * / ^ ( )`), choose which input fields show, and
test it live before saving.

**Exchange rates.** Base currency is INR. The ICEGATE customs page is
CAPTCHA-protected, so Master Data → *Currencies* → **Import export rates
(ICEGATE)** lets you solve the CAPTCHA on ICEGATE, paste the table, and it reads
the **Export** rate column and applies it (also fully editable by hand).

## Project layout

```
server/   Express API, Prisma schema + seed, costing engine (src/lib/costing.ts)
client/   React + AntD app (pages/, components/, api/)
server/uploads/   product images (git-ignored)
```

## Useful scripts

```bash
npm run dev              # run both apps
npm run db:setup         # push schema + seed
npm --workspace server run db:reset     # wipe + reseed
npm --workspace server run db:studio    # Prisma Studio (browse the DB)
npm run build            # type-check + build both apps
```
