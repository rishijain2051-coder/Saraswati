/**
 * The one list of what counts as operational data.
 *
 * Both the demo seed (which rebuilds a factory) and `db:clean` (which leaves an empty
 * one) clear exactly the same tables, so the two can never drift apart. If you add a
 * model, add it here — a table left out keeps rows that point at records by id, and
 * they resurface attached to whichever new record is later given that id.
 *
 * Configuration is deliberately NOT touched: logins, currencies, units, attributes,
 * cost formulas, stage lines, trades, holidays, workforce settings and statutory
 * components are setup, not data.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';

const UPLOADS = path.join(__dirname, '..', 'uploads');

export async function wipeOperational(prisma: PrismaClient): Promise<{ files: number }> {
  // Change-log rows point at records by id. Left behind, they would resurface on
  // whichever new product or order happens to be given the same id.
  await prisma.changeLog.deleteMany();

  // The workforce goes next: its rows reference movements and the ledger, and a
  // worker left behind would carry attendance for a factory that no longer exists.
  await prisma.statutoryPostingLine.deleteMany();
  await prisma.statutoryPosting.deleteMany();
  await prisma.workerDeduction.deleteMany();
  await prisma.workerAdvance.deleteMany();
  await prisma.attendance.deleteMany();
  await prisma.workerStatutory.deleteMany();
  await prisma.workerDocument.deleteMany();
  await prisma.stageMoveWorker.deleteMany();
  await prisma.worker.deleteMany();
  await prisma.contractor.deleteMany();

  await prisma.stageMovePhoto.deleteMany();
  await prisma.stageMove.deleteMany();
  await prisma.orderLineStage.deleteMany();
  await prisma.operationSheet.deleteMany();
  await prisma.ledgerEntry.deleteMany();
  await prisma.orderLine.deleteMany();
  await prisma.order.deleteMany();
  await prisma.proformaLine.deleteMany();
  await prisma.proforma.deleteMany();

  await prisma.stockTxn.deleteMany();
  await prisma.rawItem.deleteMany();

  await prisma.productImage.deleteMany();
  await prisma.costLine.deleteMany();
  await prisma.costGroup.deleteMany();
  await prisma.costSheet.deleteMany();
  await prisma.productBuyer.deleteMany();
  await prisma.relatedProduct.deleteMany();
  await prisma.product.deleteMany();

  await prisma.buyer.deleteMany();
  await prisma.supplier.deleteMany();

  return { files: wipeUploads() };
}

/**
 * Product images, hand-over photos and worker documents all share this directory.
 *
 * NOTE: this is a filesystem path, so it is wiped regardless of which database
 * DATABASE_URL points at. Returns the number of files removed so a caller can say so
 * out loud rather than deleting a user's photos silently.
 */
export function wipeUploads(): number {
  if (!fs.existsSync(UPLOADS)) return 0;
  let n = 0;
  for (const f of fs.readdirSync(UPLOADS)) {
    if (f === '.gitkeep') continue;
    fs.unlinkSync(path.join(UPLOADS, f));
    n++;
  }
  return n;
}

/**
 * Restart every document sequence. Only `db:clean` does this: the demo seed mints real
 * numbers for the orders it creates, so resetting mid-rebuild would hand out duplicates.
 */
export async function resetDocNumbering(prisma: PrismaClient) {
  await prisma.docSequence.updateMany({ data: { lastNo: 0 } });
}
