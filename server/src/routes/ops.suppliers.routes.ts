import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { asyncHandler } from '../lib/http';
import { authenticate, requireRole } from '../middleware/auth';
import { round } from '../lib/costing';

const router = Router();
router.use(authenticate);
const canEdit = requireRole('Operator');

// ---------------------------------------------------------------------------
// Suppliers (material + jobwork vendors)
// ---------------------------------------------------------------------------

router.get(
  '/suppliers',
  asyncHandler(async (req, res) => {
    const q = (req.query.q as string | undefined)?.trim();
    const type = req.query.type as string | undefined;
    const where: any = {};
    if (type) where.type = type === 'JOBWORK' ? { in: ['JOBWORK', 'BOTH'] } : type === 'MATERIAL' ? { in: ['MATERIAL', 'BOTH'] } : type;
    if (q) where.OR = [{ name: { contains: q } }, { code: { contains: q } }];
    res.json(await prisma.supplier.findMany({ where, orderBy: { name: 'asc' } }));
  })
);

const supplierSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(['MATERIAL', 'JOBWORK', 'BOTH']).default('MATERIAL'),
  contactName: z.string().nullable().optional(),
  email: z.string().email().or(z.literal('')).nullable().optional(),
  phone: z.string().nullable().optional(),
  gstNo: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  paymentTerms: z.string().nullable().optional(),
  isActive: z.boolean().optional().default(true),
});

router.post(
  '/suppliers',
  canEdit,
  asyncHandler(async (req, res) => {
    const data = supplierSchema.parse(req.body);
    res.status(201).json(await prisma.supplier.create({ data: { ...data, code: data.code.toUpperCase() } }));
  })
);

router.patch(
  '/suppliers/:id',
  canEdit,
  asyncHandler(async (req, res) => {
    const data = supplierSchema.partial().parse(req.body);
    res.json(await prisma.supplier.update({ where: { id: Number(req.params.id) }, data: { ...data, ...(data.code ? { code: data.code.toUpperCase() } : {}) } }));
  })
);

router.delete(
  '/suppliers/:id',
  requireRole('Manager'),
  asyncHandler(async (req, res) => {
    await prisma.supplier.delete({ where: { id: Number(req.params.id) } });
    res.status(204).end();
  })
);

// ---------------------------------------------------------------------------
// Raw items + stock balances
// ---------------------------------------------------------------------------

async function balances(): Promise<Record<number, { inQty: number; outQty: number }>> {
  const grouped = await prisma.stockTxn.groupBy({ by: ['rawItemId', 'type'], _sum: { qty: true } });
  const map: Record<number, { inQty: number; outQty: number }> = {};
  for (const g of grouped) {
    map[g.rawItemId] = map[g.rawItemId] || { inQty: 0, outQty: 0 };
    if (g.type === 'IN') map[g.rawItemId].inQty = g._sum.qty || 0;
    else map[g.rawItemId].outQty = g._sum.qty || 0;
  }
  return map;
}

router.get(
  '/raw-items',
  asyncHandler(async (_req, res) => {
    const [items, bal] = await Promise.all([prisma.rawItem.findMany({ orderBy: { name: 'asc' } }), balances()]);
    res.json(
      items.map((it) => {
        const b = bal[it.id] || { inQty: 0, outQty: 0 };
        const balance = round(it.openingQty + b.inQty - b.outQty, 3);
        return { ...it, inQty: round(b.inQty, 3), outQty: round(b.outQty, 3), balance, low: balance <= it.reorderLevel };
      })
    );
  })
);

const rawItemSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  category: z.string().nullable().optional(),
  unit: z.string().min(1).default('PCS'),
  reorderLevel: z.number().min(0).default(0),
  openingQty: z.number().default(0),
  isActive: z.boolean().optional().default(true),
});

router.post(
  '/raw-items',
  canEdit,
  asyncHandler(async (req, res) => {
    const data = rawItemSchema.parse(req.body);
    res.status(201).json(await prisma.rawItem.create({ data: { ...data, code: data.code.toUpperCase() } }));
  })
);

router.patch(
  '/raw-items/:id',
  canEdit,
  asyncHandler(async (req, res) => {
    const data = rawItemSchema.partial().parse(req.body);
    res.json(await prisma.rawItem.update({ where: { id: Number(req.params.id) }, data: { ...data, ...(data.code ? { code: data.code.toUpperCase() } : {}) } }));
  })
);

router.delete(
  '/raw-items/:id',
  requireRole('Manager'),
  asyncHandler(async (req, res) => {
    await prisma.rawItem.delete({ where: { id: Number(req.params.id) } });
    res.status(204).end();
  })
);

// ---------------------------------------------------------------------------
// Stock transactions (inward / outward)
// ---------------------------------------------------------------------------

router.get(
  '/stock/txns',
  asyncHandler(async (req, res) => {
    const rawItemId = req.query.rawItemId ? Number(req.query.rawItemId) : undefined;
    res.json(
      await prisma.stockTxn.findMany({
        where: rawItemId ? { rawItemId } : undefined,
        include: { rawItem: true, supplier: true },
        orderBy: { date: 'desc' },
        take: 200,
      })
    );
  })
);

const stockTxnSchema = z.object({
  rawItemId: z.number().int(),
  type: z.enum(['IN', 'OUT']),
  qty: z.number().positive(),
  rate: z.number().min(0).optional().default(0),
  supplierId: z.number().int().nullable().optional(),
  orderRef: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  date: z.string().datetime().optional(),
});

router.post(
  '/stock/txns',
  canEdit,
  asyncHandler(async (req, res) => {
    const data = stockTxnSchema.parse(req.body);
    const txn = await prisma.stockTxn.create({
      data: {
        rawItemId: data.rawItemId,
        type: data.type,
        qty: data.qty,
        rate: data.rate ?? 0,
        supplierId: data.supplierId ?? null,
        orderRef: data.orderRef ?? null,
        note: data.note ?? null,
        date: data.date ? new Date(data.date) : new Date(),
        createdById: req.user!.sub,
      },
      include: { rawItem: true, supplier: true },
    });
    res.status(201).json(txn);
  })
);

router.delete(
  '/stock/txns/:id',
  canEdit,
  asyncHandler(async (req, res) => {
    await prisma.stockTxn.delete({ where: { id: Number(req.params.id) } });
    res.status(204).end();
  })
);

export default router;
