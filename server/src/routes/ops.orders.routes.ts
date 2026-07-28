import { Router } from 'express';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { nanoid } from 'nanoid';
import { prisma } from '../db';
import { ApiError, asyncHandler } from '../lib/http';
import { authenticate, requireRole } from '../middleware/auth';
import { nextDocNumber } from '../lib/numbering';
import { computeCostSheet } from '../lib/productCosting';
import { loadMethodMap } from '../lib/methods';
import { round } from '../lib/costing';
import { buildBoard, expandHops, MOVE_KINDS, validateMove, type MoveRow } from '../lib/production';
import { loadOrder, loadSerializedOrder, materializeStages, orderInclude, resolveStageLineId, serializeOrder, syncOrderStatus } from '../lib/orderBoard';
import { proformaPdf } from '../lib/docPdf';
import { buildEml, mailtoUrl, proformaMail } from '../lib/mailDraft';

const router = Router();
router.use(authenticate);
const canEdit = requireRole('Operator');
const canManage = requireRole('Manager');

// Hand-over photos share the product-image upload folder, served at /uploads.
const uploadDir = path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const uploadPhotos = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => cb(null, `move-${Date.now()}-${nanoid(8)}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

export const ORDER_STATUSES = ['Confirmed', 'Production', 'Ready', 'Shipped', 'Closed', 'Cancelled'] as const;
export const PROFORMA_STATUSES = ['Draft', 'Sent', 'Accepted', 'Rejected'] as const;

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
    res.json(await loadSerializedOrder(Number(req.params.id)));
  })
);

const orderLineSchema = z.object({
  id: z.number().int().optional(),
  productId: z.number().int(),
  qty: z.number().int().positive(),
  unitPrice: z.number().min(0),
});

const orderSchema = z.object({
  buyerId: z.number().int(),
  currencyId: z.number().int().nullable().optional(),
  status: z.enum(ORDER_STATUSES).optional(),
  orderDate: z.string().datetime().optional(),
  deliveryDate: z.string().datetime().nullable().optional(),
  incoterms: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  lines: z.array(orderLineSchema).default([]),
});

router.post(
  '/orders',
  canEdit,
  asyncHandler(async (req, res) => {
    const data = orderSchema.parse(req.body);
    if (data.lines.length === 0) throw new ApiError(400, 'An order needs at least one product line.');
    const number = await nextDocNumber('ORD');
    const currency = data.currencyId ? await prisma.currency.findUnique({ where: { id: data.currencyId } }) : null;

    const created = await prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
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
        },
      });
      for (let i = 0; i < data.lines.length; i++) {
        const l = data.lines[i];
        const stageLineId = await resolveStageLineId(tx, l.productId);
        const line = await tx.orderLine.create({ data: { orderId: order.id, productId: l.productId, qty: l.qty, unitPrice: l.unitPrice, sortOrder: i, stageLineId } });
        await materializeStages(tx, line.id, stageLineId);
      }
      return order;
    });

    res.status(201).json(await loadSerializedOrder(created.id));
  })
);

router.put(
  '/orders/:id',
  canEdit,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const data = orderSchema.parse(req.body);
    if (data.lines.length === 0) throw new ApiError(400, 'An order needs at least one product line.');

    const existing = await prisma.order.findUnique({ where: { id }, include: { lines: { include: { stages: true, moves: true, product: { select: { factoryCode: true } } } } } });
    if (!existing) throw new ApiError(404, 'Order not found.');

    // Lines are matched by id and PATCHED — never wiped and rebuilt — so stage
    // snapshots and movement history survive an edit.
    const keptIds = new Set(data.lines.filter((l) => l.id).map((l) => l.id!));
    for (const line of existing.lines) {
      if (keptIds.has(line.id)) continue;
      if (line.moves.length > 0) {
        throw new ApiError(409, `Cannot remove ${line.product.factoryCode}: it has ${line.moves.length} production movement(s). Undo them first.`);
      }
    }

    for (const incoming of data.lines) {
      if (!incoming.id) continue;
      const line = existing.lines.find((l) => l.id === incoming.id);
      if (!line) throw new ApiError(400, `Line ${incoming.id} does not belong to this order.`);
      const board = buildBoard(line.qty, line.stages as any, line.moves as any);
      const committed = board.wip + board.done;
      if (incoming.qty < committed) {
        throw new ApiError(409, `${line.product.factoryCode}: ${committed} pc(s) are already in production or finished — quantity cannot drop below that.`);
      }
      if (incoming.productId !== line.productId && line.moves.length > 0) {
        throw new ApiError(409, `${line.product.factoryCode}: the product cannot be swapped once production has started.`);
      }
    }

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

      for (const line of existing.lines) {
        if (!keptIds.has(line.id)) await tx.orderLine.delete({ where: { id: line.id } });
      }

      for (let i = 0; i < data.lines.length; i++) {
        const l = data.lines[i];
        if (l.id) {
          const prev = existing.lines.find((x) => x.id === l.id)!;
          await tx.orderLine.update({ where: { id: l.id }, data: { productId: l.productId, qty: l.qty, unitPrice: l.unitPrice, sortOrder: i } });
          if (l.productId !== prev.productId) {
            const stageLineId = await resolveStageLineId(tx, l.productId);
            await tx.orderLine.update({ where: { id: l.id }, data: { stageLineId } });
            await materializeStages(tx, l.id, stageLineId);
          }
        } else {
          const stageLineId = await resolveStageLineId(tx, l.productId);
          const line = await tx.orderLine.create({ data: { orderId: id, productId: l.productId, qty: l.qty, unitPrice: l.unitPrice, sortOrder: i, stageLineId } });
          await materializeStages(tx, line.id, stageLineId);
        }
      }
      await syncOrderStatus(tx, id);
    });

    res.json(await loadSerializedOrder(id));
  })
);

router.patch(
  '/orders/:id/status',
  canEdit,
  asyncHandler(async (req, res) => {
    const { status } = z.object({ status: z.enum(ORDER_STATUSES) }).parse(req.body);
    await prisma.order.update({ where: { id: Number(req.params.id) }, data: { status } });
    res.json(await loadSerializedOrder(Number(req.params.id)));
  })
);

router.delete(
  '/orders/:id',
  canManage,
  asyncHandler(async (req, res) => {
    await prisma.order.delete({ where: { id: Number(req.params.id) } });
    res.status(204).end();
  })
);

// ---------------------------------------------------------------------------
// Production routing for one order line
// ---------------------------------------------------------------------------

/**
 * Who does what, stage by stage. There is no "outsourced till N" any more: each
 * stage independently belongs to us (vendorId null) or to a vendor, so any pattern
 * works — 1-3 in-house, 4 outsourced, 5-6 in-house included.
 */
const routingSchema = z.object({
  stageLineId: z.number().int().nullable().optional(),
  stages: z
    .array(
      z.object({
        id: z.number().int(),
        vendorId: z.number().int().nullable().optional(),
        jobworkRate: z.number().min(0).optional(),
        note: z.string().nullable().optional(),
      })
    )
    .optional(),
});

router.patch(
  '/order-lines/:id/routing',
  canEdit,
  asyncHandler(async (req, res) => {
    const lineId = Number(req.params.id);
    const data = routingSchema.parse(req.body);
    const line = await prisma.orderLine.findUnique({ where: { id: lineId }, include: { stages: true } });
    if (!line) throw new ApiError(404, 'Order line not found.');

    // A stage handed to a vendor needs a rate, or the jobwork bill silently reads zero.
    for (const s of data.stages ?? []) {
      const current = line.stages.find((x) => x.id === s.id);
      if (!current) throw new ApiError(400, 'A stage in the payload does not belong to this order line.');
      const vendorId = s.vendorId !== undefined ? s.vendorId : current.vendorId;
      const rate = s.jobworkRate !== undefined ? s.jobworkRate : current.jobworkRate;
      if (vendorId && rate <= 0) throw new ApiError(400, `Set a jobwork rate for "${current.name}" — an outsourced stage with a zero rate would bill nothing.`);
    }

    await prisma.$transaction(async (tx) => {
      if (data.stageLineId !== undefined && data.stageLineId !== line.stageLineId) {
        await tx.orderLine.update({ where: { id: lineId }, data: { stageLineId: data.stageLineId } });
        await materializeStages(tx, lineId, data.stageLineId);
        return; // the old stage rows are gone, so per-stage edits no longer apply
      }
      for (const s of data.stages ?? []) {
        await tx.orderLineStage.update({
          where: { id: s.id },
          data: {
            ...(s.vendorId !== undefined ? { vendorId: s.vendorId } : {}),
            ...(s.jobworkRate !== undefined ? { jobworkRate: s.jobworkRate } : {}),
            ...(s.note !== undefined ? { note: s.note } : {}),
          },
        });
      }
    });

    res.json(await loadSerializedOrder(line.orderId));
  })
);

// ---------------------------------------------------------------------------
// Stage movements (the board) — each hand-over carries a comment and photos
// ---------------------------------------------------------------------------

const moveSchema = z.object({
  orderLineId: z.number().int(),
  kind: z.enum(MOVE_KINDS),
  fromStageId: z.number().int().nullable().optional(),
  toStageId: z.number().int().nullable().optional(),
  qty: z.number().int().positive(),
  note: z.string().nullable().optional(),
});

const movesBodySchema = z.object({
  moves: z.array(moveSchema).min(1),
  date: z.string().datetime().optional(),
  /** Hand-over comment applied to every hop this submission records. */
  comment: z.string().nullable().optional(),
});

/**
 * Record one or more piece movements.
 *
 * A forward clearance that spans several stages is expanded into one hop per stage
 * (see `expandHops`), so clearing 1 -> 4 in a single action still leaves every
 * stage's cleared count — and its jobwork — exact. Several lines may be cleared in
 * one submission; each is validated against a running board so two moves on the
 * same line are checked cumulatively.
 */
router.post(
  '/orders/:id/moves',
  canEdit,
  asyncHandler(async (req, res) => {
    const orderId = Number(req.params.id);
    const body = movesBodySchema.parse(req.body);
    const order = await loadOrder(orderId);
    if (order.status === 'Cancelled') throw new ApiError(409, 'This order is cancelled — reopen it before moving pieces.');

    const lineById = new Map(order.lines.map((l) => [l.id, l]));
    const date = body.date ? new Date(body.date) : new Date();
    const comment = body.comment?.trim() || null;

    const simulated = new Map<number, MoveRow[]>();
    const planned: { orderLineId: number; kind: string; fromStageId: number | null; toStageId: number | null; qty: number; note: string | null }[] = [];

    for (const m of body.moves) {
      const line = lineById.get(m.orderLineId);
      if (!line) throw new ApiError(400, 'A movement refers to a line that is not on this order.');
      if (line.stages.length === 0) throw new ApiError(400, `${line.product.factoryCode} has no stage line yet — assign one before moving pieces.`);

      const extra = simulated.get(m.orderLineId) ?? [];
      const boardBefore = buildBoard(line.qty, line.stages as any, [...(line.moves as any as MoveRow[]), ...extra]);
      const err = validateMove(boardBefore, { kind: m.kind, fromStageId: m.fromStageId ?? null, toStageId: m.toStageId ?? null, qty: m.qty });
      if (err) throw new ApiError(400, `${line.product.factoryCode} — ${err}`);

      // Break a multi-stage clearance into single hops, then check each one in turn.
      const hops = expandHops(boardBefore, { kind: m.kind, fromStageId: m.fromStageId ?? null, toStageId: m.toStageId ?? null, qty: m.qty });
      for (const hop of hops) {
        const board = buildBoard(line.qty, line.stages as any, [...(line.moves as any as MoveRow[]), ...extra]);
        const hopErr = validateMove(board, hop);
        if (hopErr) throw new ApiError(400, `${line.product.factoryCode} — ${hopErr}`);
        planned.push({ orderLineId: m.orderLineId, kind: hop.kind, fromStageId: hop.fromStageId, toStageId: hop.toStageId, qty: hop.qty, note: m.note?.trim() || comment });
        extra.push({ id: -1, kind: hop.kind, fromStageId: hop.fromStageId, toStageId: hop.toStageId, qty: hop.qty });
      }
      simulated.set(m.orderLineId, extra);
    }

    const result = await prisma.$transaction(async (tx) => {
      const ids: number[] = [];
      for (const p of planned) {
        const created = await tx.stageMove.create({
          data: { orderLineId: p.orderLineId, kind: p.kind, fromStageId: p.fromStageId, toStageId: p.toStageId, qty: p.qty, date, note: p.note, createdById: req.user!.sub },
        });
        ids.push(created.id);
      }
      const newStatus = await syncOrderStatus(tx, orderId);
      return { ids, newStatus };
    });

    res.status(201).json({
      ...(await loadSerializedOrder(orderId)),
      createdMoves: result.ids.length,
      moveIds: result.ids,
      /** Attach hand-over photos here — the hop the pieces actually landed on. */
      photoMoveId: result.ids[result.ids.length - 1] ?? null,
      statusChangedTo: result.newStatus,
    });
  })
);

// --- hand-over photos ------------------------------------------------------

router.post(
  '/moves/:id/photos',
  canEdit,
  uploadPhotos.array('photos', 10),
  asyncHandler(async (req, res) => {
    const moveId = Number(req.params.id);
    const move = await prisma.stageMove.findUnique({ where: { id: moveId }, include: { photos: true, orderLine: { select: { orderId: true } } } });
    if (!move) throw new ApiError(404, 'Movement not found.');
    const files = (req.files as Express.Multer.File[]) ?? [];
    if (files.length === 0) throw new ApiError(400, 'No images were uploaded.');

    let order = move.photos.length;
    for (const file of files) {
      await prisma.stageMovePhoto.create({
        data: { moveId, filename: file.filename, originalName: file.originalname, url: `/uploads/${file.filename}`, sortOrder: order++ },
      });
    }
    res.status(201).json(await loadSerializedOrder(move.orderLine.orderId));
  })
);

router.delete(
  '/moves/:moveId/photos/:photoId',
  canEdit,
  asyncHandler(async (req, res) => {
    const photo = await prisma.stageMovePhoto.findUnique({ where: { id: Number(req.params.photoId) } });
    if (!photo) throw new ApiError(404, 'Photo not found.');
    await prisma.stageMovePhoto.delete({ where: { id: photo.id } });
    fs.promises.unlink(path.join(uploadDir, photo.filename)).catch(() => undefined);
    res.status(204).end();
  })
);

/** Edit the hand-over comment after the fact. */
router.patch(
  '/moves/:id',
  canEdit,
  asyncHandler(async (req, res) => {
    const { note } = z.object({ note: z.string().nullable() }).parse(req.body);
    const move = await prisma.stageMove.findUnique({ where: { id: Number(req.params.id) }, include: { orderLine: { select: { orderId: true } } } });
    if (!move) throw new ApiError(404, 'Movement not found.');
    await prisma.stageMove.update({ where: { id: move.id }, data: { note: note?.trim() || null } });
    res.json(await loadSerializedOrder(move.orderLine.orderId));
  })
);

/** Undo the most recent movement on a line — anything older must be undone first. */
router.delete(
  '/moves/:id',
  canEdit,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const move = await prisma.stageMove.findUnique({ where: { id }, include: { orderLine: { select: { id: true, orderId: true } } } });
    if (!move) throw new ApiError(404, 'Movement not found.');

    const latest = await prisma.stageMove.findFirst({ where: { orderLineId: move.orderLineId }, orderBy: { id: 'desc' } });
    if (latest && latest.id !== id) throw new ApiError(409, 'Only the most recent movement on a line can be undone. Undo the later ones first.');

    const photos = await prisma.stageMovePhoto.findMany({ where: { moveId: id } });
    await prisma.$transaction(async (tx) => {
      await tx.stageMove.delete({ where: { id } }); // photos cascade with it
      await syncOrderStatus(tx, move.orderLine.orderId);
    });
    for (const p of photos) fs.promises.unlink(path.join(uploadDir, p.filename)).catch(() => undefined);
    res.json(await loadSerializedOrder(move.orderLine.orderId));
  })
);

// ---------------------------------------------------------------------------
// Proformas
// ---------------------------------------------------------------------------

const proformaInclude = {
  buyer: true,
  currency: true,
  lines: {
    orderBy: { sortOrder: 'asc' as const },
    include: {
      product: {
        select: {
          id: true,
          factoryCode: true,
          name: true,
          size: { select: { value: true } },
          colour: { select: { value: true } },
          material: { select: { value: true } },
          finish: { select: { value: true } },
          prodLengthIn: true,
          prodWidthIn: true,
          prodHeightIn: true,
          images: { orderBy: [{ isPrimary: 'desc' as const }, { sortOrder: 'asc' as const }], select: { id: true, url: true, filename: true, isPrimary: true, caption: true } },
        },
      },
      image: { select: { id: true, url: true, filename: true } },
    },
  },
  order: { select: { id: true, number: true } },
};

type ProformaLoaded = Awaited<ReturnType<typeof loadProforma>>;

async function loadProforma(id: number) {
  const p = await prisma.proforma.findUnique({ where: { id }, include: proformaInclude });
  if (!p) throw new ApiError(404, 'Proforma not found.');
  return p;
}

/** The photo a PI line should print: the explicit pick, else the product primary. */
function lineImage(l: any): { id: number; url: string; filename: string } | null {
  if (l.image) return l.image;
  const primary = l.product?.images?.[0];
  return primary ? { id: primary.id, url: primary.url, filename: primary.filename } : null;
}

function specsOf(p: any): string | null {
  if (!p) return null;
  const dims = [p.prodLengthIn, p.prodWidthIn, p.prodHeightIn].every((v: any) => v != null) ? `${p.prodLengthIn}x${p.prodWidthIn}x${p.prodHeightIn} in` : null;
  const bits = [dims, p.size?.value, p.colour?.value, p.material?.value, p.finish?.value].filter(Boolean);
  return bits.length ? bits.join(' · ') : null;
}

function serializeProforma(p: ProformaLoaded) {
  const lines = p.lines.map((l) => ({ ...l, image: lineImage(l), specs: specsOf(l.product), amount: round(l.qty * l.unitPrice) }));
  return {
    ...p,
    lines,
    total: round(lines.reduce((s, l) => s + l.amount, 0)),
    canEdit: !p.order && p.status !== 'Accepted',
  };
}

router.get(
  '/proformas',
  asyncHandler(async (req, res) => {
    const status = req.query.status as string | undefined;
    const list = await prisma.proforma.findMany({ where: status ? { status } : undefined, include: proformaInclude, orderBy: [{ date: 'desc' }, { id: 'desc' }] });
    res.json(list.map(serializeProforma));
  })
);

router.get(
  '/proformas/:id',
  asyncHandler(async (req, res) => {
    res.json(serializeProforma(await loadProforma(Number(req.params.id))));
  })
);

const proformaSchema = z.object({
  buyerId: z.number().int(),
  currencyId: z.number().int().nullable().optional(),
  date: z.string().datetime().optional(),
  validUntil: z.string().datetime().nullable().optional(),
  paymentTerms: z.string().nullable().optional(),
  deliveryTerms: z.string().nullable().optional(),
  incoterms: z.string().nullable().optional(),
  bankDetails: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  showImages: z.boolean().optional(),
  lines: z
    .array(
      z.object({
        productId: z.number().int().nullable().optional(),
        imageId: z.number().int().nullable().optional(),
        description: z.string().min(1),
        qty: z.number().int().positive(),
        unitPrice: z.number().min(0),
      })
    )
    .default([]),
});

function proformaData(d: z.infer<typeof proformaSchema>, currencyRate: number | null) {
  return {
    buyerId: d.buyerId,
    currencyId: d.currencyId ?? null,
    date: d.date ? new Date(d.date) : new Date(),
    validUntil: d.validUntil ? new Date(d.validUntil) : null,
    paymentTerms: d.paymentTerms ?? null,
    deliveryTerms: d.deliveryTerms ?? null,
    incoterms: d.incoterms ?? null,
    bankDetails: d.bankDetails ?? null,
    notes: d.notes ?? null,
    showImages: d.showImages ?? true,
    exchangeRate: currencyRate,
  };
}

router.post(
  '/proformas',
  canEdit,
  asyncHandler(async (req, res) => {
    const data = proformaSchema.parse(req.body);
    if (data.lines.length === 0) throw new ApiError(400, 'A proforma needs at least one line.');
    const number = await nextDocNumber('PI');
    const currency = data.currencyId ? await prisma.currency.findUnique({ where: { id: data.currencyId } }) : null;
    const p = await prisma.proforma.create({
      data: {
        number,
        ...proformaData(data, currency?.rateToBase ?? null),
        status: 'Draft',
        createdById: req.user!.sub,
        lines: {
          create: data.lines.map((l, i) => ({ productId: l.productId ?? null, imageId: l.imageId ?? null, description: l.description, qty: l.qty, unitPrice: l.unitPrice, sortOrder: i })),
        },
      },
    });
    res.status(201).json(serializeProforma(await loadProforma(p.id)));
  })
);

router.put(
  '/proformas/:id',
  canEdit,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const data = proformaSchema.parse(req.body);
    if (data.lines.length === 0) throw new ApiError(400, 'A proforma needs at least one line.');
    const current = await loadProforma(id);
    if (current.order) throw new ApiError(409, `${current.number} became order ${current.order.number} — it can no longer be edited.`);
    if (current.status === 'Accepted') throw new ApiError(409, 'An accepted proforma cannot be edited.');

    const currency = data.currencyId ? await prisma.currency.findUnique({ where: { id: data.currencyId } }) : null;
    await prisma.$transaction(async (tx) => {
      await tx.proforma.update({ where: { id }, data: proformaData(data, currency?.rateToBase ?? null) });
      await tx.proformaLine.deleteMany({ where: { proformaId: id } });
      for (let i = 0; i < data.lines.length; i++) {
        const l = data.lines[i];
        await tx.proformaLine.create({ data: { proformaId: id, productId: l.productId ?? null, imageId: l.imageId ?? null, description: l.description, qty: l.qty, unitPrice: l.unitPrice, sortOrder: i } });
      }
    });
    res.json(serializeProforma(await loadProforma(id)));
  })
);

/** Mark as sent. Accepting is a separate, order-creating step. */
router.post(
  '/proformas/:id/send',
  canEdit,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const p = await loadProforma(id);
    if (p.status === 'Accepted') throw new ApiError(409, 'This proforma is already accepted.');
    await prisma.proforma.update({ where: { id }, data: { status: 'Sent', sentAt: p.sentAt ?? new Date(), decidedAt: null, rejectReason: null } });
    res.json(serializeProforma(await loadProforma(id)));
  })
);

/** Back to draft, e.g. to fix a price before re-sending. */
router.post(
  '/proformas/:id/reopen',
  canEdit,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const p = await loadProforma(id);
    if (p.order) throw new ApiError(409, `${p.number} already became order ${p.order.number}.`);
    await prisma.proforma.update({ where: { id }, data: { status: 'Draft', decidedAt: null, rejectReason: null } });
    res.json(serializeProforma(await loadProforma(id)));
  })
);

/** Rejected — record it and stop. Nothing downstream happens. */
router.post(
  '/proformas/:id/reject',
  canEdit,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const reason = z.object({ reason: z.string().nullable().optional() }).parse(req.body ?? {}).reason ?? null;
    const p = await loadProforma(id);
    if (p.order) throw new ApiError(409, `${p.number} already became order ${p.order.number} — it cannot be rejected.`);
    await prisma.proforma.update({ where: { id }, data: { status: 'Rejected', decidedAt: new Date(), rejectReason: reason } });
    res.json(serializeProforma(await loadProforma(id)));
  })
);

/**
 * Accepted — this is the moment an order is born. The client must confirm first;
 * the server enforces the one-order-per-proforma rule.
 */
router.post(
  '/proformas/:id/accept',
  canEdit,
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const body = z.object({ deliveryDate: z.string().datetime().nullable().optional() }).parse(req.body ?? {});
    const p = await prisma.proforma.findUnique({ where: { id }, include: { lines: true, order: true } });
    if (!p) throw new ApiError(404, 'Proforma not found.');
    if (p.order) throw new ApiError(409, `Already accepted — order ${p.order.number} exists.`);

    const productLines = p.lines.filter((l) => l.productId != null);
    if (productLines.length === 0) throw new ApiError(400, 'None of the proforma lines is linked to a product, so no order can be created. Link products first.');

    const number = await nextDocNumber('ORD');
    const order = await prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          number,
          buyerId: p.buyerId,
          currencyId: p.currencyId,
          status: 'Confirmed',
          exchangeRate: p.exchangeRate,
          incoterms: p.incoterms,
          deliveryDate: body.deliveryDate ? new Date(body.deliveryDate) : null,
          notes: p.notes,
          proformaId: p.id,
          createdById: req.user!.sub,
        },
      });
      for (let i = 0; i < productLines.length; i++) {
        const l = productLines[i];
        const stageLineId = await resolveStageLineId(tx, l.productId!);
        const line = await tx.orderLine.create({ data: { orderId: created.id, productId: l.productId!, qty: l.qty, unitPrice: l.unitPrice, sortOrder: i, stageLineId } });
        await materializeStages(tx, line.id, stageLineId);
      }
      await tx.proforma.update({ where: { id }, data: { status: 'Accepted', decidedAt: new Date(), rejectReason: null } });
      return created;
    });

    const skipped = p.lines.length - productLines.length;
    res.status(201).json({ order: await loadSerializedOrder(order.id), skippedLines: skipped });
  })
);

router.delete(
  '/proformas/:id',
  canManage,
  asyncHandler(async (req, res) => {
    const p = await prisma.proforma.findUnique({ where: { id: Number(req.params.id) }, include: { order: { select: { number: true } } } });
    if (!p) throw new ApiError(404, 'Proforma not found.');
    if (p.order) throw new ApiError(409, `${p.number} became order ${p.order.number} — delete the order first.`);
    await prisma.proforma.delete({ where: { id: p.id } });
    res.status(204).end();
  })
);

// --- PI document: PDF + e-mail draft ---------------------------------------

function pdfInputFor(s: ReturnType<typeof serializeProforma>) {
  return {
    number: s.number,
    date: s.date,
    validUntil: s.validUntil,
    currencyCode: s.currency?.code ?? 'INR',
    showImages: s.showImages,
    buyer: s.buyer,
    incoterms: s.incoterms,
    paymentTerms: s.paymentTerms,
    deliveryTerms: s.deliveryTerms,
    bankDetails: s.bankDetails,
    notes: s.notes,
    lines: s.lines.map((l: any) => ({
      description: l.description,
      qty: l.qty,
      unitPrice: l.unitPrice,
      productCode: l.product?.factoryCode ?? null,
      specs: l.specs,
      imageFile: l.image?.filename ?? null,
    })),
  };
}

router.get(
  '/proformas/:id/pdf',
  asyncHandler(async (req, res) => {
    const s = serializeProforma(await loadProforma(Number(req.params.id)));
    const pdf = await proformaPdf(pdfInputFor(s));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${s.number}.pdf"`);
    res.send(pdf);
  })
);

function mailInputFor(s: ReturnType<typeof serializeProforma>, senderName?: string | null) {
  return {
    number: s.number,
    date: s.date,
    validUntil: s.validUntil,
    currencyCode: s.currency?.code ?? 'INR',
    total: s.total,
    incoterms: s.incoterms,
    paymentTerms: s.paymentTerms,
    deliveryTerms: s.deliveryTerms,
    buyer: s.buyer,
    lines: s.lines.map((l: any) => ({ description: l.description, qty: l.qty, unitPrice: l.unitPrice })),
    senderName: senderName ?? null,
  };
}

/** Everything the UI needs to offer both send routes. */
router.get(
  '/proformas/:id/mail',
  asyncHandler(async (req, res) => {
    const s = serializeProforma(await loadProforma(Number(req.params.id)));
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub }, select: { name: true } });
    const to = s.buyer.email ? [s.buyer.email] : [];
    const mail = proformaMail(mailInputFor(s, me?.name));
    res.json({
      to,
      hasEmail: to.length > 0,
      buyerName: s.buyer.name,
      contactName: s.buyer.contactName ?? null,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      mailto: to.length ? mailtoUrl(to, mail.subject, mail.text) : null,
      filename: `${s.number}.pdf`,
      // mailto: cannot carry an attachment — the .eml route is how the PDF rides along.
      attachmentSupported: false,
    });
  })
);

/** A ready-to-send draft (To/Subject/Body + the PI PDF attached) as an .eml file. */
router.get(
  '/proformas/:id/email.eml',
  asyncHandler(async (req, res) => {
    const s = serializeProforma(await loadProforma(Number(req.params.id)));
    const me = await prisma.user.findUnique({ where: { id: req.user!.sub }, select: { name: true } });
    if (!s.buyer.email) throw new ApiError(400, `${s.buyer.name} has no e-mail address. Add one in Master Data → Buyers.`);
    const mail = proformaMail(mailInputFor(s, me?.name));
    const pdf = await proformaPdf(pdfInputFor(s));
    const eml = buildEml({
      to: [s.buyer.email],
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      attachments: [{ filename: `${s.number}.pdf`, contentType: 'application/pdf', content: pdf }],
    });
    res.setHeader('Content-Type', 'message/rfc822');
    res.setHeader('Content-Disposition', `attachment; filename="${s.number}.eml"`);
    res.send(Buffer.from(eml, 'utf8'));
  })
);

export default router;
