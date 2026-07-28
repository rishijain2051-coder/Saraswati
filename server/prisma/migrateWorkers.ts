/**
 * Standalone runner for the Manforce migration:
 *
 *   npm run db:workers
 *
 * Turns wage rows still recorded against a typed name into real worker records and
 * repoints the ledger, so historic balances and statements survive intact. Also seeds
 * the Manforce defaults if they are missing. Safe to run repeatedly.
 */
import { PrismaClient } from '@prisma/client';
import { migrateTypedWorkers, seedManforceDefaults } from './manforceSeed';

const prisma = new PrismaClient();

async function main() {
  await seedManforceDefaults(prisma);
  const { workers, entries } = await migrateTypedWorkers(prisma);
  if (!entries) {
    console.log('Nothing to migrate — every wage entry already names a worker.');
    return;
  }
  console.log(`Created ${workers} worker(s) and repointed ${entries} wage entr(ies).`);
  console.log('Their pay type defaults to daily with a zero rate, so nothing accrues until you set it.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
