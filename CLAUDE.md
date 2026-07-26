# CLAUDE.md — Saraswati Export ERP

Guidance for working in this repo.

## What this is

Modular ERP for Saraswati Export (furniture/hardware exporter). **Phase 1 =
Product Management** only; the other four modules (Manforce, Raw Material,
Operations, Sales) are placeholders on the home screen and route to
`PlaceholderModule`. Build everything with expansion to those modules in mind —
Product data (costing, dimensions, differentiated volumes) is intended to feed
Operations (operation sheets) and Sales (container planning).

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

## Conventions

- SQLite has no Prisma enums — enum-like fields are `String` validated with zod in routes.
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

Type-check without building: `npx tsc --noEmit -p server/tsconfig.json` and
`npx tsc --noEmit -p client/tsconfig.json`.
