import { Router } from 'express';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { nanoid } from 'nanoid';
import { prisma } from '../db';
import { ApiError, asyncHandler } from '../lib/http';
import { authenticate, requireRole } from '../middleware/auth';
import { computeCostSheet } from '../lib/productCosting';
import { loadMethodMap } from '../lib/methods';
import type { MethodMap } from '../lib/costing';

const router = Router();
router.use(authenticate);

const canEdit = requireRole('Operator');

// ---------------------------------------------------------------------------
// Image upload storage
// ---------------------------------------------------------------------------

const uploadDir = path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}-${nanoid(8)}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const num = z.number().nullable().optional();

const lineSchema = z.object({
  name: z.string().min(1),
  qty: z.number().default(1),
  wastagePct: z.number().default(0),
  actualL: num,
  actualW: num,
  actualH: num,
  costL: num,
  costW: num,
  costH: num,
  actualWeight: num,
  unit: z.string().nullable().optional(),
  rate: z.number().default(0),
  sortOrder: z.number().int().optional().default(0),
});

const groupSchema = z.object({
  head: z.string().min(1),
  name: z.string().min(1),
  method: z.string().min(1),
  dimUnit: z.string().nullable().optional(),
  sortOrder: z.number().int().optional().default(0),
  notes: z.string().nullable().optional(),
  lines: z.array(lineSchema).default([]),
});

const costSheetSchema = z.object({
  currencyId: z.number().int().nullable().optional(),
  factoryExpensePct: z.number().default(15),
  marginPct: z.number().default(15),
  notes: z.string().nullable().optional(),
  groups: z.array(groupSchema).default([]),
});

const productSchema = z.object({
  factoryCode: z.string().min(1),
  name: z.string().min(1),
  alias: z.string().nullable().optional(),
  status: z.string().optional().default('Draft'),
  description: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  itemTypeId: z.number().int().nullable().optional(),
  productTypeId: z.number().int().nullable().optional(),
  sizeId: z.number().int().nullable().optional(),
  colourId: z.number().int().nullable().optional(),
  materialId: z.number().int().nullable().optional(),
  finishId: z.number().int().nullable().optional(),
  unitId: z.number().int().nullable().optional(),
  prodLengthIn: num,
  prodWidthIn: num,
  prodHeightIn: num,
  netWeightKg: num,
  grossWeightKg: num,
  packLengthIn: num,
  packWidthIn: num,
  packHeightIn: num,
  piecesPerCarton: z.number().int().nullable().optional(),
  volumeBeforePackingCbm: num,
  volumeAfterPackingCbm: num,
  buyers: z
    .array(z.object({ buyerId: z.number().int(), buyerCode: z.string().nullable().optional() }))
    .default([]),
  related: z
    .array(z.object({ relatedId: z.number().int(), relation: z.string(), note: z.string().nullable().optional() }))
    .default([]),
  costSheet: costSheetSchema.nullable().optional(),
});

type ProductInput = z.infer<typeof productSchema>;

function scalarData(d: ProductInput) {
  return {
    factoryCode: d.factoryCode.trim(),
    name: d.name.trim(),
    alias: d.alias ?? null,
    status: d.status ?? 'Draft',
    description: d.description ?? null,
    notes: d.notes ?? null,
    itemTypeId: d.itemTypeId ?? null,
    productTypeId: d.productTypeId ?? null,
    sizeId: d.sizeId ?? null,
    colourId: d.colourId ?? null,
    materialId: d.materialId ?? null,
    finishId: d.finishId ?? null,
    unitId: d.unitId ?? null,
    prodLengthIn: d.prodLengthIn ?? null,
    prodWidthIn: d.prodWidthIn ?? null,
    prodHeightIn: d.prodHeightIn ?? null,
    netWeightKg: d.netWeightKg ?? null,
    grossWeightKg: d.grossWeightKg ?? null,
    packLengthIn: d.packLengthIn ?? null,
    packWidthIn: d.packWidthIn ?? null,
    packHeightIn: d.packHeightIn ?? null,
    piecesPerCarton: d.piecesPerCarton ?? null,
    volumeBeforePackingCbm: d.volumeBeforePackingCbm ?? null,
    volumeAfterPackingCbm: d.volumeAfterPackingCbm ?? null,
  };
}

function lineData(ln: z.infer<typeof lineSchema>) {
  return {
    name: ln.name,
    qty: ln.qty,
    wastagePct: ln.wastagePct,
    actualL: ln.actualL ?? null,
    actualW: ln.actualW ?? null,
    actualH: ln.actualH ?? null,
    costL: ln.costL ?? null,
    costW: ln.costW ?? null,
    costH: ln.costH ?? null,
    actualWeight: ln.actualWeight ?? null,
    unit: ln.unit ?? null,
    rate: ln.rate,
    sortOrder: ln.sortOrder ?? 0,
  };
}

function costSheetCreate(cs: z.infer<typeof costSheetSchema>) {
  return {
    version: 1,
    isActive: true,
    currencyId: cs.currencyId ?? null,
    factoryExpensePct: cs.factoryExpensePct,
    marginPct: cs.marginPct,
    notes: cs.notes ?? null,
    groups: {
      create: cs.groups.map((g) => ({
        head: g.head,
        name: g.name,
        method: g.method,
        dimUnit: g.dimUnit ?? null,
        sortOrder: g.sortOrder ?? 0,
        notes: g.notes ?? null,
        lines: { create: g.lines.map(lineData) },
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// Includes / serialization
// ---------------------------------------------------------------------------

const activeSheetInclude = {
  where: { isActive: true },
  include: {
    currency: true,
    groups: { orderBy: { sortOrder: 'asc' as const }, include: { lines: { orderBy: { sortOrder: 'asc' as const } } } },
  },
};

const listInclude = {
  productType: true,
  size: true,
  colour: true,
  material: true,
  unit: true,
  buyers: { include: { buyer: true } },
  images: { where: { isPrimary: true }, take: 1 },
  costSheets: activeSheetInclude,
};

const fullInclude = {
  itemType: true,
  productType: true,
  size: true,
  colour: true,
  material: true,
  finish: true,
  unit: true,
  createdBy: { select: { id: true, name: true } },
  buyers: { include: { buyer: true } },
  images: { orderBy: [{ isPrimary: 'desc' as const }, { sortOrder: 'asc' as const }] },
  relatedFrom: {
    include: {
      related: {
        select: { id: true, factoryCode: true, name: true, images: { where: { isPrimary: true }, take: 1 } },
      },
    },
  },
  costSheets: activeSheetInclude,
};

function summarize(product: any, methods: MethodMap) {
  const sheet = product.costSheets?.[0];
  const computed = computeCostSheet(sheet, methods) as any;
  return {
    id: product.id,
    factoryCode: product.factoryCode,
    name: product.name,
    alias: product.alias,
    status: product.status,
    productType: product.productType?.value ?? null,
    size: product.size?.value ?? null,
    colour: product.colour?.value ?? null,
    material: product.material?.value ?? null,
    unit: product.unit?.code ?? null,
    buyers: (product.buyers || []).map((b: any) => ({ name: b.buyer.name, code: b.buyer.code, buyerCode: b.buyerCode })),
    primaryImage: product.images?.[0]?.url ?? null,
    currency: computed?.currency ? { code: computed.currency.code, symbol: computed.currency.symbol } : null,
    exFactory: computed?.summary.exFactory ?? null,
    fob: computed?.summary.fob ?? null,
    nonFob: computed?.summary.nonFob ?? null,
    updatedAt: product.updatedAt,
  };
}

function serializeFull(product: any, methods: MethodMap) {
  const sheet = product.costSheets?.[0];
  return {
    ...product,
    costSheet: computeCostSheet(sheet, methods),
    costSheets: undefined,
    related: (product.relatedFrom || []).map((r: any) => ({
      id: r.id,
      relatedId: r.relatedId,
      relation: r.relation,
      note: r.note,
      product: {
        id: r.related.id,
        factoryCode: r.related.factoryCode,
        name: r.related.name,
        primaryImage: r.related.images?.[0]?.url ?? null,
      },
    })),
    relatedFrom: undefined,
  };
}

// ---------------------------------------------------------------------------
// List + filters
// ---------------------------------------------------------------------------

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = (req.query.q as string | undefined)?.trim();
    const numParam = (v: unknown) => (v != null && v !== '' ? Number(v) : undefined);
    const where: any = {};
    if (q) where.OR = [{ factoryCode: { contains: q } }, { name: { contains: q } }, { alias: { contains: q } }];
    if (req.query.status) where.status = req.query.status;
    const filters: Array<[string, string]> = [
      ['productTypeId', 'productTypeId'],
      ['sizeId', 'sizeId'],
      ['colourId', 'colourId'],
      ['materialId', 'materialId'],
      ['finishId', 'finishId'],
    ];
    for (const [param, field] of filters) {
      const val = numParam(req.query[param]);
      if (val !== undefined) where[field] = val;
    }
    const buyerId = numParam(req.query.buyerId);
    if (buyerId !== undefined) where.buyers = { some: { buyerId } };

    const [methods, products] = await Promise.all([
      loadMethodMap(),
      prisma.product.findMany({ where, include: listInclude, orderBy: { updatedAt: 'desc' } }),
    ]);
    res.json(products.map((p) => summarize(p, methods)));
  })
);

// Executive-summary view (same data, compact) for the Product Catalogue.
router.get(
  '/catalogue',
  asyncHandler(async (_req, res) => {
    const [methods, products] = await Promise.all([
      loadMethodMap(),
      prisma.product.findMany({ include: listInclude, orderBy: { factoryCode: 'asc' } }),
    ]);
    res.json(products.map((p) => summarize(p, methods)));
  })
);

// ---------------------------------------------------------------------------
// Single product (full detail + computed costing)
// ---------------------------------------------------------------------------

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const [methods, product] = await Promise.all([
      loadMethodMap(),
      prisma.product.findUnique({ where: { id: Number(req.params.id) }, include: fullInclude }),
    ]);
    if (!product) throw new ApiError(404, 'Product not found.');
    res.json(serializeFull(product, methods));
  })
);

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

router.post(
  '/',
  canEdit,
  asyncHandler(async (req, res) => {
    const data = productSchema.parse(req.body);
    const product = await prisma.product.create({
      data: {
        ...scalarData(data),
        createdById: req.user!.sub,
        buyers: { create: data.buyers.map((b) => ({ buyerId: b.buyerId, buyerCode: b.buyerCode ?? null })) },
        relatedFrom: {
          create: data.related.map((r) => ({ relatedId: r.relatedId, relation: r.relation, note: r.note ?? null })),
        },
        costSheets: data.costSheet ? { create: [costSheetCreate(data.costSheet)] } : undefined,
      },
      include: fullInclude,
    });
    res.status(201).json(serializeFull(product, await loadMethodMap()));
  })
);

// ---------------------------------------------------------------------------
// Update (replaces buyers / related / cost sheet)
// ---------------------------------------------------------------------------

router.put(
  '/:id',
  canEdit,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const data = productSchema.parse(req.body);

    await prisma.$transaction(async (tx) => {
      await tx.product.update({ where: { id }, data: scalarData(data) });

      await tx.productBuyer.deleteMany({ where: { productId: id } });
      for (const b of data.buyers) {
        await tx.productBuyer.create({ data: { productId: id, buyerId: b.buyerId, buyerCode: b.buyerCode ?? null } });
      }

      await tx.relatedProduct.deleteMany({ where: { productId: id } });
      for (const r of data.related) {
        await tx.relatedProduct.create({ data: { productId: id, relatedId: r.relatedId, relation: r.relation, note: r.note ?? null } });
      }

      await tx.costSheet.deleteMany({ where: { productId: id } });
      if (data.costSheet) {
        await tx.costSheet.create({ data: { productId: id, ...costSheetCreate(data.costSheet) } });
      }
    });

    const product = await prisma.product.findUnique({ where: { id }, include: fullInclude });
    res.json(serializeFull(product, await loadMethodMap()));
  })
);

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

router.delete(
  '/:id',
  requireRole('Manager'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const images = await prisma.productImage.findMany({ where: { productId: id } });
    await prisma.product.delete({ where: { id } });
    for (const img of images) {
      const p = path.join(uploadDir, img.filename);
      fs.promises.unlink(p).catch(() => undefined);
    }
    res.status(204).end();
  })
);

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

router.post(
  '/:id/images',
  canEdit,
  upload.array('images', 20),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const product = await prisma.product.findUnique({ where: { id }, include: { images: true } });
    if (!product) throw new ApiError(404, 'Product not found.');
    const files = (req.files as Express.Multer.File[]) || [];
    if (files.length === 0) throw new ApiError(400, 'No image files received.');

    let hasPrimary = product.images.some((i) => i.isPrimary);
    let order = product.images.length;
    const created = [];
    for (const file of files) {
      const isPrimary = !hasPrimary;
      hasPrimary = true;
      created.push(
        await prisma.productImage.create({
          data: {
            productId: id,
            filename: file.filename,
            originalName: file.originalname,
            url: `/uploads/${file.filename}`,
            isPrimary,
            sortOrder: order++,
          },
        })
      );
    }
    res.status(201).json(created);
  })
);

const imagePatchSchema = z.object({
  isPrimary: z.boolean().optional(),
  caption: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
});

router.patch(
  '/:id/images/:imageId',
  canEdit,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const imageId = Number(req.params.imageId);
    const data = imagePatchSchema.parse(req.body);
    const updated = await prisma.$transaction(async (tx) => {
      if (data.isPrimary) await tx.productImage.updateMany({ where: { productId: id }, data: { isPrimary: false } });
      return tx.productImage.update({
        where: { id: imageId },
        data: {
          ...(data.isPrimary !== undefined ? { isPrimary: data.isPrimary } : {}),
          ...(data.caption !== undefined ? { caption: data.caption } : {}),
          ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
        },
      });
    });
    res.json(updated);
  })
);

router.delete(
  '/:id/images/:imageId',
  canEdit,
  asyncHandler(async (req, res) => {
    const imageId = Number(req.params.imageId);
    const img = await prisma.productImage.findUnique({ where: { id: imageId } });
    if (!img) throw new ApiError(404, 'Image not found.');
    await prisma.productImage.delete({ where: { id: imageId } });
    fs.promises.unlink(path.join(uploadDir, img.filename)).catch(() => undefined);
    // If we removed the primary, promote the next image.
    if (img.isPrimary) {
      const next = await prisma.productImage.findFirst({ where: { productId: img.productId }, orderBy: { sortOrder: 'asc' } });
      if (next) await prisma.productImage.update({ where: { id: next.id }, data: { isPrimary: true } });
    }
    res.status(204).end();
  })
);

export default router;
