import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { ApiError, asyncHandler } from '../lib/http';
import { authenticate, requireRole } from '../middleware/auth';
import { ALLOWED_VARS } from '../lib/costing';
import { validateExpr } from '../lib/expr';

const router = Router();
router.use(authenticate);

// Managers+ may edit master data; everyone may read.
const canEdit = requireRole('Manager');

// ---------------------------------------------------------------------------
// Currencies
// ---------------------------------------------------------------------------

router.get(
  '/currencies',
  asyncHandler(async (_req, res) => {
    res.json(await prisma.currency.findMany({ orderBy: [{ isBase: 'desc' }, { code: 'asc' }] }));
  })
);

const currencySchema = z.object({
  code: z.string().min(1).max(8),
  name: z.string().min(1),
  symbol: z.string().max(8).optional().default(''),
  rateToBase: z.number().positive().default(1),
  isBase: z.boolean().optional().default(false),
  isActive: z.boolean().optional().default(true),
});

router.post(
  '/currencies',
  canEdit,
  asyncHandler(async (req, res) => {
    const data = currencySchema.parse(req.body);
    const created = await prisma.$transaction(async (tx) => {
      if (data.isBase) await tx.currency.updateMany({ data: { isBase: false }, where: {} });
      return tx.currency.create({
        data: { ...data, code: data.code.toUpperCase(), rateToBase: data.isBase ? 1 : data.rateToBase },
      });
    });
    res.status(201).json(created);
  })
);

router.patch(
  '/currencies/:id',
  canEdit,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const data = currencySchema.partial().parse(req.body);
    const updated = await prisma.$transaction(async (tx) => {
      if (data.isBase) await tx.currency.updateMany({ data: { isBase: false }, where: { id: { not: id } } });
      return tx.currency.update({
        where: { id },
        data: { ...data, ...(data.code ? { code: data.code.toUpperCase() } : {}), ...(data.isBase ? { rateToBase: 1 } : {}) },
      });
    });
    res.json(updated);
  })
);

router.delete(
  '/currencies/:id',
  canEdit,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const cur = await prisma.currency.findUnique({ where: { id } });
    if (cur?.isBase) throw new ApiError(400, 'Cannot delete the base currency.');
    await prisma.currency.delete({ where: { id } });
    res.status(204).end();
  })
);

// Bulk-update exchange rates (used by the ICEGATE export-rate importer).
const bulkRatesSchema = z.object({
  rates: z.array(z.object({ code: z.string().min(1), rateToBase: z.number().positive() })),
});

router.post(
  '/currencies/bulk-rates',
  canEdit,
  asyncHandler(async (req, res) => {
    const { rates } = bulkRatesSchema.parse(req.body);
    let updated = 0;
    const unmatched: string[] = [];
    for (const r of rates) {
      const cur = await prisma.currency.findUnique({ where: { code: r.code.toUpperCase() } });
      if (!cur) {
        unmatched.push(r.code);
        continue;
      }
      if (cur.isBase) continue; // base currency stays at 1
      await prisma.currency.update({ where: { id: cur.id }, data: { rateToBase: r.rateToBase } });
      updated++;
    }
    res.json({ updated, unmatched });
  })
);

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

router.get(
  '/units',
  asyncHandler(async (_req, res) => {
    res.json(await prisma.unit.findMany({ orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] }));
  })
);

const unitSchema = z.object({
  code: z.string().min(1).max(12),
  name: z.string().min(1),
  sortOrder: z.number().int().optional().default(0),
  isActive: z.boolean().optional().default(true),
});

router.post(
  '/units',
  canEdit,
  asyncHandler(async (req, res) => {
    const data = unitSchema.parse(req.body);
    res.status(201).json(await prisma.unit.create({ data: { ...data, code: data.code.toUpperCase() } }));
  })
);

router.patch(
  '/units/:id',
  canEdit,
  asyncHandler(async (req, res) => {
    const data = unitSchema.partial().parse(req.body);
    res.json(
      await prisma.unit.update({
        where: { id: Number(req.params.id) },
        data: { ...data, ...(data.code ? { code: data.code.toUpperCase() } : {}) },
      })
    );
  })
);

router.delete(
  '/units/:id',
  canEdit,
  asyncHandler(async (req, res) => {
    await prisma.unit.delete({ where: { id: Number(req.params.id) } });
    res.status(204).end();
  })
);

// ---------------------------------------------------------------------------
// Buyers
// ---------------------------------------------------------------------------

router.get(
  '/buyers',
  asyncHandler(async (req, res) => {
    const q = (req.query.q as string | undefined)?.trim();
    res.json(
      await prisma.buyer.findMany({
        where: q ? { OR: [{ name: { contains: q } }, { code: { contains: q } }] } : undefined,
        orderBy: { name: 'asc' },
      })
    );
  })
);

const buyerSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  country: z.string().optional().nullable(),
  contactName: z.string().optional().nullable(),
  email: z.string().email().optional().or(z.literal('')).nullable(),
  phone: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  isActive: z.boolean().optional().default(true),
});

router.post(
  '/buyers',
  canEdit,
  asyncHandler(async (req, res) => {
    const data = buyerSchema.parse(req.body);
    res.status(201).json(await prisma.buyer.create({ data: { ...data, code: data.code.toUpperCase() } }));
  })
);

router.patch(
  '/buyers/:id',
  canEdit,
  asyncHandler(async (req, res) => {
    const data = buyerSchema.partial().parse(req.body);
    res.json(
      await prisma.buyer.update({
        where: { id: Number(req.params.id) },
        data: { ...data, ...(data.code ? { code: data.code.toUpperCase() } : {}) },
      })
    );
  })
);

router.delete(
  '/buyers/:id',
  canEdit,
  asyncHandler(async (req, res) => {
    await prisma.buyer.delete({ where: { id: Number(req.params.id) } });
    res.status(204).end();
  })
);

// ---------------------------------------------------------------------------
// Attribute values (product type / size / colour / material / finish / item type)
// ---------------------------------------------------------------------------

router.get(
  '/attributes',
  asyncHandler(async (req, res) => {
    const type = req.query.type as string | undefined;
    res.json(
      await prisma.attributeValue.findMany({
        where: type ? { type } : undefined,
        orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }, { value: 'asc' }],
      })
    );
  })
);

const attrSchema = z.object({
  type: z.string().min(1),
  value: z.string().min(1),
  code: z.string().optional().nullable(),
  sortOrder: z.number().int().optional().default(0),
  isActive: z.boolean().optional().default(true),
});

router.post(
  '/attributes',
  canEdit,
  asyncHandler(async (req, res) => {
    const data = attrSchema.parse(req.body);
    res.status(201).json(await prisma.attributeValue.create({ data: { ...data, type: data.type.toUpperCase() } }));
  })
);

router.patch(
  '/attributes/:id',
  canEdit,
  asyncHandler(async (req, res) => {
    const data = attrSchema.partial().parse(req.body);
    res.json(await prisma.attributeValue.update({ where: { id: Number(req.params.id) }, data }));
  })
);

router.delete(
  '/attributes/:id',
  canEdit,
  asyncHandler(async (req, res) => {
    await prisma.attributeValue.delete({ where: { id: Number(req.params.id) } });
    res.status(204).end();
  })
);

// ---------------------------------------------------------------------------
// Stage lines — named production routes (products are assigned one)
// ---------------------------------------------------------------------------

const stageLineInclude = { steps: { orderBy: { sortOrder: 'asc' as const } }, _count: { select: { products: true, orderLines: true } } };

router.get(
  '/stage-lines',
  asyncHandler(async (_req, res) => {
    res.json(await prisma.stageLine.findMany({ include: stageLineInclude, orderBy: [{ isDefault: 'desc' }, { code: 'asc' }] }));
  })
);

const stageLineSchema = z.object({
  code: z.string().min(1).max(16),
  name: z.string().min(1),
  isDefault: z.boolean().optional().default(false),
  isActive: z.boolean().optional().default(true),
  notes: z.string().nullable().optional(),
  steps: z.array(z.string().min(1)).min(1, 'A stage line needs at least one stage.'),
});

router.post(
  '/stage-lines',
  canEdit,
  asyncHandler(async (req, res) => {
    const data = stageLineSchema.parse(req.body);
    const created = await prisma.$transaction(async (tx) => {
      if (data.isDefault) await tx.stageLine.updateMany({ data: { isDefault: false }, where: {} });
      return tx.stageLine.create({
        data: {
          code: data.code.toUpperCase(),
          name: data.name,
          isDefault: data.isDefault,
          isActive: data.isActive,
          notes: data.notes ?? null,
          steps: { create: data.steps.map((name, i) => ({ name, sortOrder: i })) },
        },
        include: stageLineInclude,
      });
    });
    res.status(201).json(created);
  })
);

/**
 * Editing a stage line never disturbs live orders: each order line keeps its own
 * snapshot of the steps (OrderLineStage), so masters stay freely editable.
 */
router.patch(
  '/stage-lines/:id',
  canEdit,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const data = stageLineSchema.partial().parse(req.body);
    if (data.steps && data.steps.length === 0) throw new ApiError(400, 'A stage line needs at least one stage.');
    const updated = await prisma.$transaction(async (tx) => {
      if (data.isDefault) await tx.stageLine.updateMany({ data: { isDefault: false }, where: { id: { not: id } } });
      await tx.stageLine.update({
        where: { id },
        data: {
          ...(data.code ? { code: data.code.toUpperCase() } : {}),
          ...(data.name ? { name: data.name } : {}),
          ...(data.isDefault !== undefined ? { isDefault: data.isDefault } : {}),
          ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
          ...(data.notes !== undefined ? { notes: data.notes } : {}),
        },
      });
      if (data.steps) {
        await tx.stageLineStep.deleteMany({ where: { stageLineId: id } });
        for (let i = 0; i < data.steps.length; i++) await tx.stageLineStep.create({ data: { stageLineId: id, name: data.steps[i], sortOrder: i } });
      }
      return tx.stageLine.findUnique({ where: { id }, include: stageLineInclude });
    });
    res.json(updated);
  })
);

router.delete(
  '/stage-lines/:id',
  canEdit,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const line = await prisma.stageLine.findUnique({ where: { id }, include: { _count: { select: { products: true, orderLines: true } } } });
    if (!line) throw new ApiError(404, 'Stage line not found.');
    const { products, orderLines } = line._count;
    if (products + orderLines > 0) {
      throw new ApiError(409, `${line.code} is used by ${products} product(s) and ${orderLines} order line(s). Deactivate it instead of deleting.`);
    }
    await prisma.stageLine.delete({ where: { id } });
    res.status(204).end();
  })
);

// ---------------------------------------------------------------------------
// Cost methods (user-editable costing formulas)
// ---------------------------------------------------------------------------

router.get(
  '/methods',
  asyncHandler(async (_req, res) => {
    res.json(await prisma.costMethod.findMany({ orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] }));
  })
);

const methodSchema = z.object({
  code: z.string().min(1).max(16),
  label: z.string().min(1),
  measureUnit: z.string().min(1).default('UNIT'),
  expression: z.string().min(1),
  usesL: z.boolean().optional().default(false),
  usesW: z.boolean().optional().default(false),
  usesH: z.boolean().optional().default(false),
  usesWeight: z.boolean().optional().default(false),
  usesWastage: z.boolean().optional().default(true),
  dimUnit: z.string().optional().nullable(),
  sortOrder: z.number().int().optional().default(0),
  isActive: z.boolean().optional().default(true),
});

function checkExpr(expr?: string) {
  if (expr === undefined) return;
  const err = validateExpr(expr, ALLOWED_VARS);
  if (err) throw new ApiError(400, `Invalid formula: ${err}. Allowed variables: ${ALLOWED_VARS.join(', ')}.`);
}

router.post(
  '/methods',
  canEdit,
  asyncHandler(async (req, res) => {
    const data = methodSchema.parse(req.body);
    checkExpr(data.expression);
    res.status(201).json(await prisma.costMethod.create({ data: { ...data, code: data.code.toUpperCase() } }));
  })
);

router.patch(
  '/methods/:id',
  canEdit,
  asyncHandler(async (req, res) => {
    const data = methodSchema.partial().parse(req.body);
    checkExpr(data.expression);
    res.json(
      await prisma.costMethod.update({
        where: { id: Number(req.params.id) },
        data: { ...data, ...(data.code ? { code: data.code.toUpperCase() } : {}) },
      })
    );
  })
);

router.delete(
  '/methods/:id',
  canEdit,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const method = await prisma.costMethod.findUnique({ where: { id } });
    if (!method) throw new ApiError(404, 'Method not found.');
    if (method.isBuiltIn) throw new ApiError(400, 'Built-in methods cannot be deleted (you can edit or deactivate them).');
    const inUse = await prisma.costGroup.count({ where: { method: method.code } });
    if (inUse > 0) throw new ApiError(409, `This method is used by ${inUse} cost group(s). Deactivate it instead.`);
    await prisma.costMethod.delete({ where: { id } });
    res.status(204).end();
  })
);

export default router;
