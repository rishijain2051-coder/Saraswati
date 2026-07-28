import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../db';

type Tx = Prisma.TransactionClient | PrismaClient;

async function bump(client: Tx, key: string): Promise<string> {
  const year = new Date().getFullYear();
  let seq = await client.docSequence.findUnique({ where: { key } });
  if (!seq) seq = await client.docSequence.create({ data: { key, prefix: key, useYear: false, lastNo: 0 } });
  const next = seq.lastNo + 1;
  await client.docSequence.update({ where: { key }, data: { lastNo: next } });
  const pad = String(next).padStart(4, '0');
  return seq.useYear ? `${seq.prefix}-${year}-${pad}` : `${seq.prefix}-${pad}`;
}

/**
 * Generate the next document number for a sequence key (PI, ORD, OP, DC, IC).
 * Year-based keys produce e.g. PI-2026-0001; others produce OP-0001.
 *
 * Pass the caller's transaction client when already inside `$transaction` —
 * opening a nested transaction would deadlock, because SQLite serialises writes
 * and the inner one can never start until the outer one commits.
 */
export async function nextDocNumber(key: string, tx?: Tx): Promise<string> {
  if (tx) return bump(tx, key);
  return prisma.$transaction((client) => bump(client, key));
}
