import { prisma } from '../db';

/**
 * Generate the next document number for a sequence key (PI, ORD, OP, PO).
 * Year-based keys produce e.g. PI-2026-0001; others produce OP-0001.
 * Uses a transaction so concurrent calls don't collide.
 */
export async function nextDocNumber(key: string): Promise<string> {
  const year = new Date().getFullYear();
  return prisma.$transaction(async (tx) => {
    let seq = await tx.docSequence.findUnique({ where: { key } });
    if (!seq) seq = await tx.docSequence.create({ data: { key, prefix: key, useYear: false, lastNo: 0 } });
    const next = seq.lastNo + 1;
    await tx.docSequence.update({ where: { key }, data: { lastNo: next } });
    const pad = String(next).padStart(4, '0');
    return seq.useYear ? `${seq.prefix}-${year}-${pad}` : `${seq.prefix}-${pad}`;
  });
}
