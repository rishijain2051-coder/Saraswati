import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { ApiError, asyncHandler } from '../lib/http';
import { authenticate, requireRole } from '../middleware/auth';
import { nextDocNumber } from '../lib/numbering';
import { computeCostSheet } from '../lib/productCosting';
import { loadMethodMap } from '../lib/methods';
import { round } from '../lib/costing';

const router = Router();
router.use(authenticate);
const canEdit = requireRole('Operator');
const canManage = requireRole('Manager');

// ---------------------------------------------------------------------------
// Operation sheets (live-linked to product costing) + stages
// ---------------------------------------------------------------------------

const sheetInclude = {
  product: { select: { id: true, factoryCode: true, name: true, unit: { select: { code: true } } } },
  order: { select: { id: true, number: true } },
  vendor: { select: { id: true, name: true } },
  stages: { include: { vendor: { select: { id: true, name: true } } }, orderBy: { sortOrder: 'asc' as const } },
};

/** Explode a product's live costing to per-piece + order-total figures. */
function explode(computed: any, qty: number) {
  if (!computed) return null;
  const groups = (computed.groups || []).map((g: any) => ({
    head: g.head,
    name: g.name,
    method: g.method,
    total: g.total,
    orderTotal: round(g.total * qty),
    lines: (g.lines || []).map((l: any) => ({
      name: l.name,
      unit: l.unit,
      measure: l.measure,
      amount: l.amount,
      orderMeasure: round((l.measure || 0) * qty, 3),
      orderAmount: round((l.amount || 0) * qty),
    })),
  }));
  const s = computed.summary;
  const headTotalsOrder: Record<string, number> = {};
  for (const [k, v] of Object.entries(s.headTotals as Record<string, number>)) headTotalsOrder[k] = round(v * qty);
  return {
    currency: computed.currency ? { code: computed.currency.code, symbol: computed.currency.symbol } : null,
    perPiece: s,
    order: {
      qty,
      headTotals: headTotalsOrder,
      exFactory: round(s.exFactory * qty),
      forwarding: round(s.forwarding * qty),
      fob: round(s.fob * qty),
      nonFob: round(s.nonFob * qty),
    },
    groups,
  };
}

async function explosionFor(productId: number, qty: number) {
  const [methods, product] = await Promise.all([
    loadMethodMap(),
    prisma.product.findUnique({
      where: { id: productId },
      include: { costSheets: { where: { isActive: true }, include: { currency: true, groups: { orderBy: { sortOrder: 'asc' }, include: { lines: { orderBy: { sortOrder: 'asc' } } } } } } },
    }),
  ]);
  return explode(computeCostSheet(product?.costSheets?.[0], methods), qty);
}

router.get(
  '/operation-sheets',
  asyncHandler(async (req, res) => {
    const status = req.query.status as string | undefined;
    res.json(await prisma.operationSheet.findMany({ where: status ? { status } : undefined, include: sheetInclude, orderBy: { createdAt: 'desc' } }));
  })
);

router.get(
  '/operation-sheets/:id',
  asyncHandler(async (req, res) => {
    const sheet = await prisma.operationSheet.findUnique({ where: { id: Number(req.params.id) }, include: sheetInclude });
    if (!sheet) throw new ApiError(404, 'Operation sheet not found.');
    const explosion = await explosionFor(sheet.productId, sheet.qty);
    res.json({ ...sheet, explosion });
  })
);

const sheetSchema = z.object({
  productId: z.number().int(),
  orderId: z.number().int().nullable().optional(),
  qty: z.number().int().positive().default(1),
  producedQty: z.number().int().min(0).optional(),
  mode: z.enum(['INHOUSE', 'OUTSOURCED']).optional(),
  vendorId: z.number().int().nullable().optional(),
  jobworkCost: z.number().min(0).optional(),
  notes: z.string().nullable().optional(),
  status: z.string().optional(),
  split: z.boolean().optional(), // when true, allow a second sheet for same order+product
});

async function stageTemplatesFor(productTypeId: number | null) {
  let templates = await prisma.productionStageTemplate.findMany({ where: { productTypeId: productTypeId ?? undefined, isActive: true }, orderBy: { sortOrder: 'asc' } });
  if (productTypeId == null || templates.length === 0) {
    templates = await prisma.productionStageTemplate.findMany({ where: { productTypeId: null, isActive: true }, orderBy: { sortOrder: 'asc' } });
  }
  return templates;
}

router.post(
  '/operation-sheets',
  canEdit,
  asyncHandler(async (req, res) => {
    const data = sheetSchema.parse(req.body);
    const product = await prisma.product.findUnique({ where: { id: data.productId } });
    if (!product) throw new ApiError(404, 'Product not found.');

    // Find-or-create: if a sheet already exists for this order+product, return it
    // (unless the caller explicitly wants to split into another sheet).
    if (data.orderId && !data.split) {
      const existing = await prisma.operationSheet.findFirst({ where: { orderId: data.orderId, productId: data.productId } });
      if (existing) {
        const full = await prisma.operationSheet.findUnique({ where: { id: existing.id }, include: sheetInclude });
        const explosion = await explosionFor(full!.productId, full!.qty);
        return res.status(200).json({ ...full, explosion, existing: true });
      }
    }

    const templates = await stageTemplatesFor(product.productTypeId ?? null);
    const number = await nextDocNumber('OP');
    const sheet = await prisma.operationSheet.create({
      data: {
        number,
        productId: data.productId,
        orderId: data.orderId ?? null,
        qty: data.qty,
        mode: data.mode ?? 'INHOUSE',
        vendorId: data.vendorId ?? null,
        jobworkCost: data.jobworkCost ?? 0,
        status: data.status ?? 'Draft',
        notes: data.notes ?? null,
        createdById: req.user!.sub,
        stages: { create: templates.map((t, i) => ({ name: t.name, sortOrder: i })) },
      },
      include: sheetInclude,
    });
    const explosion = await explosionFor(sheet.productId, sheet.qty);
    res.status(201).json({ ...sheet, explosion });
  })
);

// Bulk-assign sheets to an outsourcing vendor (or back to in-house with vendorId null).
router.post(
  '/operation-sheets/bulk-outsource',
  canEdit,
  asyncHandler(async (req, res) => {
    const body = z.object({ ids: z.array(z.number().int()).min(1), vendorId: z.number().int().nullable() }).parse(req.body);
    await prisma.operationSheet.updateMany({
      where: { id: { in: body.ids } },
      data: { mode: body.vendorId ? 'OUTSOURCED' : 'INHOUSE', vendorId: body.vendorId },
    });
    res.json({ updated: body.ids.length });
  })
);

router.put(
  '/operation-sheets/:id',
  canEdit,
  asyncHandler(async (req, res) => {
    const data = sheetSchema.partial().parse(req.body);
    const sheet = await prisma.operationSheet.update({
      where: { id: Number(req.params.id) },
      data: {
        ...(data.qty != null ? { qty: data.qty } : {}),
        ...(data.producedQty != null ? { producedQty: data.producedQty } : {}),
        ...(data.mode ? { mode: data.mode } : {}),
        ...(data.vendorId !== undefined ? { vendorId: data.vendorId } : {}),
        ...(data.jobworkCost != null ? { jobworkCost: data.jobworkCost } : {}),
        ...(data.orderId !== undefined ? { orderId: data.orderId } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
        ...(data.status ? { status: data.status } : {}),
      },
      include: sheetInclude,
    });
    const explosion = await explosionFor(sheet.productId, sheet.qty);
    res.json({ ...sheet, explosion });
  })
);

router.delete(
  '/operation-sheets/:id',
  canManage,
  asyncHandler(async (req, res) => {
    await prisma.operationSheet.delete({ where: { id: Number(req.params.id) } });
    res.status(204).end();
  })
);

// --- stages ---
const stageSchema = z.object({
  name: z.string().min(1).optional(),
  mode: z.enum(['INHOUSE', 'OUTSOURCED']).optional(),
  vendorId: z.number().int().nullable().optional(),
  jobworkCost: z.number().min(0).optional(),
  status: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'DONE']).optional(),
  qtyDone: z.number().int().min(0).optional(),
  assignee: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

router.post(
  '/operation-sheets/:id/stages',
  canEdit,
  asyncHandler(async (req, res) => {
    const operationSheetId = Number(req.params.id);
    const data = stageSchema.parse(req.body);
    const count = await prisma.opStage.count({ where: { operationSheetId } });
    res.status(201).json(await prisma.opStage.create({ data: { operationSheetId, name: data.name || 'New Stage', sortOrder: data.sortOrder ?? count, mode: data.mode ?? 'INHOUSE', vendorId: data.vendorId ?? null, jobworkCost: data.jobworkCost ?? 0, status: data.status ?? 'NOT_STARTED', qtyDone: data.qtyDone ?? 0, assignee: data.assignee ?? null, note: data.note ?? null } }));
  })
);

router.patch(
  '/operation-sheets/:id/stages/:stageId',
  canEdit,
  asyncHandler(async (req, res) => {
    const data = stageSchema.parse(req.body);
    res.json(await prisma.opStage.update({ where: { id: Number(req.params.stageId) }, data }));
  })
);

router.delete(
  '/operation-sheets/:id/stages/:stageId',
  canEdit,
  asyncHandler(async (req, res) => {
    await prisma.opStage.delete({ where: { id: Number(req.params.stageId) } });
    res.status(204).end();
  })
);

// ---------------------------------------------------------------------------
// Payments ledger (per party, running dues)
// ---------------------------------------------------------------------------

router.get(
  '/payments',
  asyncHandler(async (req, res) => {
    const where: any = {};
    if (req.query.partyType) where.partyType = req.query.partyType;
    if (req.query.supplierId) where.supplierId = Number(req.query.supplierId);
    if (req.query.buyerId) where.buyerId = Number(req.query.buyerId);
    res.json(
      await prisma.ledgerEntry.findMany({
        where,
        include: { supplier: { select: { name: true } }, buyer: { select: { name: true } } },
        orderBy: { date: 'desc' },
        take: 300,
      })
    );
  })
);

// Aggregated dues per party.
router.get(
  '/payments/parties',
  asyncHandler(async (_req, res) => {
    const entries = await prisma.ledgerEntry.findMany();
    const map: Record<string, { partyType: string; partyName: string; supplierId: number | null; buyerId: number | null; billed: number; paid: number }> = {};
    for (const e of entries) {
      const key = `${e.partyType}:${e.supplierId ?? e.buyerId ?? e.partyName}`;
      const row = (map[key] = map[key] || { partyType: e.partyType, partyName: e.partyName, supplierId: e.supplierId, buyerId: e.buyerId, billed: 0, paid: 0 });
      if (e.kind === 'BILL') row.billed += e.amount;
      else row.paid += e.amount;
    }
    res.json(Object.values(map).map((r) => ({ ...r, billed: round(r.billed), paid: round(r.paid), balance: round(r.billed - r.paid) })));
  })
);

const ledgerSchema = z.object({
  partyType: z.enum(['SUPPLIER', 'JOBWORK', 'BUYER', 'WORKER']),
  supplierId: z.number().int().nullable().optional(),
  buyerId: z.number().int().nullable().optional(),
  partyName: z.string().min(1),
  kind: z.enum(['BILL', 'PAYMENT']),
  amount: z.number().positive(),
  currency: z.string().optional().default('INR'),
  date: z.string().datetime().optional(),
  ref: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});

router.post(
  '/payments',
  canManage,
  asyncHandler(async (req, res) => {
    const data = ledgerSchema.parse(req.body);
    res.status(201).json(
      await prisma.ledgerEntry.create({
        data: {
          partyType: data.partyType,
          supplierId: data.supplierId ?? null,
          buyerId: data.buyerId ?? null,
          partyName: data.partyName,
          kind: data.kind,
          amount: data.amount,
          currency: data.currency ?? 'INR',
          date: data.date ? new Date(data.date) : new Date(),
          ref: data.ref ?? null,
          note: data.note ?? null,
          createdById: req.user!.sub,
        },
      })
    );
  })
);

router.delete(
  '/payments/:id',
  canManage,
  asyncHandler(async (req, res) => {
    await prisma.ledgerEntry.delete({ where: { id: Number(req.params.id) } });
    res.status(204).end();
  })
);

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

router.get(
  '/ops/dashboard',
  asyncHandler(async (_req, res) => {
    const [pendingOrders, inProduction, entries, recentProformas, rawItems, stockGrouped] = await Promise.all([
      prisma.order.count({ where: { status: { notIn: ['Shipped', 'Closed', 'Cancelled'] } } }),
      prisma.operationSheet.count({ where: { status: 'InProgress' } }),
      prisma.ledgerEntry.findMany(),
      prisma.proforma.findMany({ include: { buyer: { select: { name: true } }, currency: true }, orderBy: { date: 'desc' }, take: 5 }),
      prisma.rawItem.findMany(),
      prisma.stockTxn.groupBy({ by: ['rawItemId', 'type'], _sum: { qty: true } }),
    ]);

    let receivable = 0;
    let payable = 0;
    for (const e of entries) {
      const signed = e.kind === 'BILL' ? e.amount : -e.amount;
      if (e.partyType === 'BUYER') receivable += signed;
      else payable += signed;
    }

    const bal: Record<number, { i: number; o: number }> = {};
    for (const g of stockGrouped) {
      bal[g.rawItemId] = bal[g.rawItemId] || { i: 0, o: 0 };
      if (g.type === 'IN') bal[g.rawItemId].i = g._sum.qty || 0;
      else bal[g.rawItemId].o = g._sum.qty || 0;
    }
    const lowStock = rawItems
      .map((it) => ({ id: it.id, name: it.name, unit: it.unit, balance: round(it.openingQty + (bal[it.id]?.i || 0) - (bal[it.id]?.o || 0), 3), reorderLevel: it.reorderLevel }))
      .filter((it) => it.balance <= it.reorderLevel);

    res.json({
      pendingOrders,
      inProduction,
      receivable: round(receivable),
      payable: round(payable),
      recentProformas: recentProformas.map((p) => ({ id: p.id, number: p.number, buyer: p.buyer.name, status: p.status, date: p.date })),
      lowStock,
    });
  })
);

export default router;
