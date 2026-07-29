import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../db';

type Tx = Prisma.TransactionClient | PrismaClient;

/**
 * Generate the next document number for a sequence key (PI, ORD, OP).
 * Year-based keys produce e.g. PI-2026-0001; others produce OP-0001.
 *
 * The counter is bumped with a single atomic `lastNo = lastNo + 1` and the new value
 * read from the same statement's result. Reading the row and writing it back would
 * leave a window where two callers both see the same `lastNo` and mint the same
 * number — which SQLite's deferred locking allows, because the read takes no lock.
 *
 * Being atomic, this is safe to call either inside or outside a transaction. Pass the
 * caller's `tx` when already inside `$transaction`: a nested transaction would
 * deadlock, since SQLite serialises writes and the inner one cannot start until the
 * outer commits.
 */
/**
 * Document series that carry the year. The fallback below creates a missing sequence, and
 * getting `useYear` wrong there would mint `DPI-0001` and then `DPI-2026-0002` once a
 * seed corrected the row — one series in two formats.
 */
const YEAR_KEYS = new Set(['PI', 'ORD', 'DPI', 'DORD']);

export async function nextDocNumber(key: string, tx?: Tx): Promise<string> {
  const client: Tx = tx ?? prisma;
  const year = new Date().getFullYear();

  let seq;
  try {
    seq = await client.docSequence.update({ where: { key }, data: { lastNo: { increment: 1 } } });
  } catch {
    // First use of this key: create it already claiming number 1. If another caller
    // won that race, fall back to the atomic increment.
    try {
      seq = await client.docSequence.create({ data: { key, prefix: key, useYear: YEAR_KEYS.has(key), lastNo: 1 } });
    } catch {
      seq = await client.docSequence.update({ where: { key }, data: { lastNo: { increment: 1 } } });
    }
  }

  const pad = String(seq.lastNo).padStart(4, '0');
  return seq.useYear ? `${seq.prefix}-${year}-${pad}` : `${seq.prefix}-${pad}`;
}
