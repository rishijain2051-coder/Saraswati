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

// FOB (INR) for a product's active cost sheet.
async function productFobInr(productId: number): Promise<number> {
  const [methods, product] = await Promise.all([
    loadMethodMap(),
    prisma.product.findUnique({
      where: { id: productId },
      include: { costSheets: { where: { isActive: true }, include: { groups: { include: { lines: true } } } } },
    }),
  ]);
  const computed = computeCostSheet(product?.costSheets?.[0], methods) as any;
  return computed?.summary?.fob ?? 0;
}

// Suggested selling price = FOB(INR) converted to the target currency (INR per unit = rateToBase).
router.get(
  '/ops/price',
  asyncHandler(async (req, res) => {
    const productId = Number(req.query.productId);
    const currencyId = req.query.currencyId ? Number(req.query.currencyId) : undefined;
    const fobInr = await productFobInr(productId);
    const currency = currencyId ? await prisma.currency.findUnique({ where: { id: currencyId } }) : null;
    const rate = currency?.rateToBase ?? 1;
    res.json({ fobInr: round(fobInr), rate, currencyCode: currency?.code ?? 'INR', suggested: round(fobInr / (rate || 1)) });
  })
);

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

const orderInclude = {
  buyer: true,
  currency: true,
  lines: { include: { product: { select: { id: true, factoryCode: true, name: true } } }, orderBy: { sortOrder: 'asc' as const } },
  proforma: { select: { id: true, number: true } },
  sheets: { select: { id: true, number: true, status: true, productId: true, qty: true, producedQty: true, mode: true } },
};

function orderTotal(o: any): number {
  return round((o.lines || []).reduce((s: number, l: any) => s + l.qty * l.unitPrice, 0));
}

// Attach production progress: per-line planned/produced/pending + order totals.
function serializeOrder(o: any) {
  const sheets = o.sheets || [];
  const lines = (o.lines || []).map((l: any) => {
    const ls = sheets.filter((s: any) => s.productId === l.productId);
    const planned = ls.reduce((a: number, s: any) => a + (s.qty || 0), 0);
    const produced = ls.reduce((a: number, s: any) => a + (s.producedQty || 0), 0);
    return { ...l, planned, produced, pending: Math.max(l.qty - produced, 0), sheetCount: ls.length };
  });
  const totalOrdered = lines.reduce((a: number, l: any) => a + l.qty, 0);
  const totalProduced = lines.reduce((a: number, l: any) => a + l.produced, 0);
  return { ...o, lines, total: orderTotal(o), totalOrdered, totalProduced, totalPending: Math.max(totalOrdered - totalProduced, 0) };
}

router.get(
  '/orders',
  asyncHandler(async (req, res) => {
    const status = req.query.status as string | undefined;
    const orders = await prisma.order.findMany({ where: status ? { status } : undefined, include: orderInclude, orderBy: { orderDate: 'desc' } });
    res.json(orders.map(serializeOrder));
  })
);

router.get(
  '/orders/:id',
  asyncHandler(async (req, res) => {
    const o = await prisma.order.findUnique({ where: { id: Number(req.params.id) }, include: orderInclude });
    if (!o) throw new ApiError(404, 'Order not found.');
    res.json(serializeOrder(o));
  })
);

// Bulk-create operation sheets for every order line that has none yet.
router.post(
  '/orders/:id/generate-sheets',
  canEdit,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const order = await prisma.order.findUnique({ where: { id }, include: { lines: true, sheets: true } });
    if (!order) throw new ApiError(404, 'Order not found.');
    let created = 0;
    for (const line of order.lines) {
      if (order.sheets.some((s) => s.productId === line.productId)) continue;
      const product = await prisma.product.findUnique({ where: { id: line.productId } });
      let templates = await prisma.productionStageTemplate.findMany({ where: { productTypeId: product?.productTypeId ?? undefined, isActive: true }, orderBy: { sortOrder: 'asc' } });
      if (!product?.productTypeId || templates.length === 0) templates = await prisma.productionStageTemplate.findMany({ where: { productTypeId: null, isActive: true }, orderBy: { sortOrder: 'asc' } });
      const number = await nextDocNumber('OP');
      await prisma.operationSheet.create({
        data: { number, productId: line.productId, orderId: id, qty: line.qty, status: 'InProgress', createdById: req.user!.sub, stages: { create: templates.map((t, i) => ({ name: t.name, sortOrder: i })) } },
      });
      created++;
    }
    res.json({ created });
  })
);

const orderSchema = z.object({
  buyerId: z.number().int(),
  currencyId: z.number().int().nullable().optional(),
  status: z.string().optional(),
  orderDate: z.string().datetime().optional(),
  deliveryDate: z.string().datetime().nullable().optional(),
  incoterms: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  lines: z.array(z.object({ productId: z.number().int(), qty: z.number().int().positive(), unitPrice: z.number().min(0) })).default([]),
});

router.post(
  '/orders',
  canEdit,
  asyncHandler(async (req, res) => {
    const data = orderSchema.parse(req.body);
    const number = await nextDocNumber('ORD');
    const currency = data.currencyId ? await prisma.currency.findUnique({ where: { id: data.currencyId } }) : null;
    const o = await prisma.order.create({
      data: {
        number,
        buyerId: data.buyerId,
        currencyId: data.currencyId ?? null,
        status: data.status ?? 'Confirmed',
        orderDate: data.orderDate ? new Date(data.orderDate) : new Date(),
        deliveryDate: data.deliveryDate ? new Date(data.deliveryDate) : null,
        incoterms: data.incoterms ?? null,
        notes: data.notes ?? null,
        exchangeRate: currency?.rateToBase ?? null,
        createdById: req.user!.sub,
        lines: { create: data.lines.map((l, i) => ({ productId: l.productId, qty: l.qty, unitPrice: l.unitPrice, sortOrder: i })) },
      },
      include: orderInclude,
    });
    res.status(201).json(serializeOrder(o));
  })
);

router.put(
  '/orders/:id',
  canEdit,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const data = orderSchema.parse(req.body);
    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id },
        data: {
          buyerId: data.buyerId,
          currencyId: data.currencyId ?? null,
          ...(data.status ? { status: data.status } : {}),
          ...(data.orderDate ? { orderDate: new Date(data.orderDate) } : {}),
          deliveryDate: data.deliveryDate ? new Date(data.deliveryDate) : null,
          incoterms: data.incoterms ?? null,
          notes: data.notes ?? null,
        },
      });
      await tx.orderLine.deleteMany({ where: { orderId: id } });
      for (let i = 0; i < data.lines.length; i++) {
        const l = data.lines[i];
        await tx.orderLine.create({ data: { orderId: id, productId: l.productId, qty: l.qty, unitPrice: l.unitPrice, sortOrder: i } });
      }
    });
    const o = await prisma.order.findUnique({ where: { id }, include: orderInclude });
    res.json(serializeOrder(o));
  })
);

router.patch(
  '/orders/:id/status',
  canEdit,
  asyncHandler(async (req, res) => {
    const status = z.object({ status: z.string().min(1) }).parse(req.body).status;
    res.json(await prisma.order.update({ where: { id: Number(req.params.id) }, data: { status } }));
  })
);

router.delete(
  '/orders/:id',
  requireRole('Manager'),
  asyncHandler(async (req, res) => {
    await prisma.order.delete({ where: { id: Number(req.params.id) } });
    res.status(204).end();
  })
);

// ---------------------------------------------------------------------------
// Proformas
// ---------------------------------------------------------------------------

const proformaInclude = {
  buyer: true,
  currency: true,
  lines: { include: { product: { select: { id: true, factoryCode: true, name: true } } }, orderBy: { sortOrder: 'asc' as const } },
  order: { select: { id: true, number: true } },
};

function proformaTotal(p: any): number {
  return round((p.lines || []).reduce((s: number, l: any) => s + l.qty * l.unitPrice, 0));
}

router.get(
  '/proformas',
  asyncHandler(async (req, res) => {
    const status = req.query.status as string | undefined;
    const list = await prisma.proforma.findMany({ where: status ? { status } : undefined, include: proformaInclude, orderBy: { date: 'desc' } });
    res.json(list.map((p) => ({ ...p, total: proformaTotal(p) })));
  })
);

router.get(
  '/proformas/:id',
  asyncHandler(async (req, res) => {
    const p = await prisma.proforma.findUnique({ where: { id: Number(req.params.id) }, include: proformaInclude });
    if (!p) throw new ApiError(404, 'Proforma not found.');
    res.json({ ...p, total: proformaTotal(p) });
  })
);

const proformaSchema = z.object({
  buyerId: z.number().int(),
  currencyId: z.number().int().nullable().optional(),
  status: z.string().optional(),
  date: z.string().datetime().optional(),
  validUntil: z.string().datetime().nullable().optional(),
  paymentTerms: z.string().nullable().optional(),
  deliveryTerms: z.string().nullable().optional(),
  incoterms: z.string().nullable().optional(),
  bankDetails: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  lines: z
    .array(z.object({ productId: z.number().int().nullable().optional(), description: z.string().min(1), qty: z.number().int().positive(), unitPrice: z.number().min(0) }))
    .default([]),
});

function proformaData(d: z.infer<typeof proformaSchema>, currencyRate: number | null) {
  return {
    buyerId: d.buyerId,
    currencyId: d.currencyId ?? null,
    status: d.status ?? 'Draft',
    date: d.date ? new Date(d.date) : new Date(),
    validUntil: d.validUntil ? new Date(d.validUntil) : null,
    paymentTerms: d.paymentTerms ?? null,
    deliveryTerms: d.deliveryTerms ?? null,
    incoterms: d.incoterms ?? null,
    bankDetails: d.bankDetails ?? null,
    notes: d.notes ?? null,
    exchangeRate: currencyRate,
  };
}

router.post(
  '/proformas',
  canEdit,
  asyncHandler(async (req, res) => {
    const data = proformaSchema.parse(req.body);
    const number = await nextDocNumber('PI');
    const currency = data.currencyId ? await prisma.currency.findUnique({ where: { id: data.currencyId } }) : null;
    const p = await prisma.proforma.create({
      data: {
        number,
        ...proformaData(data, currency?.rateToBase ?? null),
        createdById: req.user!.sub,
        lines: { create: data.lines.map((l, i) => ({ productId: l.productId ?? null, description: l.description, qty: l.qty, unitPrice: l.unitPrice, sortOrder: i })) },
      },
      include: proformaInclude,
    });
    res.status(201).json({ ...p, total: proformaTotal(p) });
  })
);

router.put(
  '/proformas/:id',
  canEdit,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const data = proformaSchema.parse(req.body);
    const currency = data.currencyId ? await prisma.currency.findUnique({ where: { id: data.currencyId } }) : null;
    await prisma.$transaction(async (tx) => {
      await tx.proforma.update({ where: { id }, data: proformaData(data, currency?.rateToBase ?? null) });
      await tx.proformaLine.deleteMany({ where: { proformaId: id } });
      for (let i = 0; i < data.lines.length; i++) {
        const l = data.lines[i];
        await tx.proformaLine.create({ data: { proformaId: id, productId: l.productId ?? null, description: l.description, qty: l.qty, unitPrice: l.unitPrice, sortOrder: i } });
      }
    });
    const p = await prisma.proforma.findUnique({ where: { id }, include: proformaInclude });
    res.json({ ...p, total: proformaTotal(p) });
  })
);

router.patch(
  '/proformas/:id/status',
  canEdit,
  asyncHandler(async (req, res) => {
    const status = z.object({ status: z.string().min(1) }).parse(req.body).status;
    res.json(await prisma.proforma.update({ where: { id: Number(req.params.id) }, data: { status } }));
  })
);

// Convert an accepted proforma into a confirmed order.
router.post(
  '/proformas/:id/convert',
  canEdit,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const p = await prisma.proforma.findUnique({ where: { id }, include: { lines: true, order: true } });
    if (!p) throw new ApiError(404, 'Proforma not found.');
    if (p.order) throw new ApiError(409, `Already converted to order ${p.order.number}.`);
    const lines = p.lines.filter((l) => l.productId != null);
    if (lines.length === 0) throw new ApiError(400, 'Proforma has no product lines to convert.');
    const number = await nextDocNumber('ORD');
    const order = await prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          number,
          buyerId: p.buyerId,
          currencyId: p.currencyId,
          status: 'Confirmed',
          exchangeRate: p.exchangeRate,
          proformaId: p.id,
          createdById: req.user!.sub,
          lines: { create: lines.map((l, i) => ({ productId: l.productId!, qty: l.qty, unitPrice: l.unitPrice, sortOrder: i })) },
        },
        include: orderInclude,
      });
      await tx.proforma.update({ where: { id }, data: { status: 'Accepted' } });
      return created;
    });
    res.status(201).json(serializeOrder(order));
  })
);

router.delete(
  '/proformas/:id',
  requireRole('Manager'),
  asyncHandler(async (req, res) => {
    await prisma.proforma.delete({ where: { id: Number(req.params.id) } });
    res.status(204).end();
  })
);

export default router;
