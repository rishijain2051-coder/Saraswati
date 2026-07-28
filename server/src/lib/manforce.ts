/**
 * Manforce aggregation: loads what the workforce engine needs and turns it into
 * positions, statements and totals.
 *
 * `lib/workforce.ts` is the pure engine and knows nothing about the database. This
 * file is the seam between them — the equivalent of what `buildFinanceContext` does
 * for orders. Everything is computed on read, so a corrected rate, a new holiday or a
 * back-dated attendance mark restates the money immediately.
 *
 * ONE ACCOUNT PER PAYEE. A worker paid directly by the factory is their own party. A
 * worker in a contractor's gang is NOT: their earnings roll up into the contractor's
 * balance, because the contractor is who gets paid. Counting both would double the
 * payable, so `directWorkers` and `contractors` partition the workforce.
 */
import { prisma } from '../db';
import { round } from './costing';
import { buildStatement, type StatementRow } from './finance';
import {
  accrualStart,
  attendanceEarnings,
  computeStatutory,
  dayKey,
  labourEvents,
  monthKey,
  rulesFrom,
  wageBase,
  workerPosition,
  type AdvanceRow,
  type ChargeRow,
  type EarningEvent,
  type StatutoryComponentDef,
  type WorkerPosition,
  type WorkforceRules,
} from './workforce';

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** The Admin's rules plus the holiday calendar, as the engine wants them. */
export async function loadRules(): Promise<{ rules: WorkforceRules; holidays: Set<string>; holidayList: { date: Date; name: string }[]; defaultAdvanceRecovery: number }> {
  const [setting, holidays] = await Promise.all([prisma.workforceSetting.findUnique({ where: { id: 1 } }), prisma.holiday.findMany({ orderBy: { date: 'asc' } })]);
  return {
    rules: rulesFrom(setting),
    holidays: new Set(holidays.map((h) => dayKey(h.date))),
    holidayList: holidays.map((h) => ({ date: h.date, name: h.name })),
    defaultAdvanceRecovery: setting?.defaultAdvanceRecovery ?? 0,
  };
}

/** Create the settings row on first use so the UI always has something to edit. */
export async function ensureSettings() {
  return prisma.workforceSetting.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}

// ---------------------------------------------------------------------------
// The context
// ---------------------------------------------------------------------------

export const workerSelect = {
  id: true,
  code: true,
  name: true,
  payType: true,
  dailyRate: true,
  otHourlyRate: true,
  monthlySalary: true,
  joinedOn: true,
  exitOn: true,
  accrualFrom: true,
  isActive: true,
  contractorId: true,
  tradeId: true,
  trade: { select: { id: true, name: true } },
  contractor: { select: { id: true, name: true, code: true } },
} as const;

export type WorkerRow = Awaited<ReturnType<typeof prisma.worker.findMany<{ select: typeof workerSelect }>>>[number];

export interface WorkerAccount {
  worker: WorkerRow;
  earnings: EarningEvent[];
  deductions: ChargeRow[];
  statutory: ChargeRow[];
  advances: (AdvanceRow & { note?: string | null; ref?: string | null })[];
  payments: (ChargeRow & { ref?: string | null; note?: string | null })[];
  position: WorkerPosition;
}

export interface ContractorAccount {
  contractor: { id: number; code: string; name: string; phone: string | null; gstNo: string | null; paymentTerms: string | null };
  workers: WorkerAccount[];
  /** Earned by the gang, less what has been charged back to them. */
  accrued: number;
  deducted: number;
  statutoryDeducted: number;
  advanced: number;
  paid: number;
  balance: number;
}

export interface WorkforceContext {
  rules: WorkforceRules;
  holidays: Set<string>;
  /** Every worker's own account, gang members included. */
  accounts: Map<number, WorkerAccount>;
  /** Workers the factory pays itself — these are payable parties. */
  directWorkers: WorkerAccount[];
  /** Gangs, which are payable parties in place of their members. */
  contractors: ContractorAccount[];
  /** Legacy wage rows still recorded against a typed name, awaiting migration. */
  unlinked: { partyName: string; billed: number; paid: number; balance: number }[];
  components: StatutoryComponentDef[];
  statutory: StatutoryDue[];
  to: Date;
}

export interface StatutoryDue {
  componentId: number;
  code: string;
  name: string;
  payeeName: string;
  isProvision: boolean;
  employee: number;
  employer: number;
  accrued: number;
  paid: number;
  balance: number;
  workers: number;
}

const sum = (rows: { amount: number }[]) => round(rows.reduce((a, r) => a + r.amount, 0));

/**
 * Everything about every worker, in one read.
 *
 * Earnings run from the worker's accrual start to `to` (today by default), because a
 * running account has no period to close — "earned so far" is the only meaningful
 * figure.
 */
export async function buildWorkforceContext(opts: { to?: Date } = {}): Promise<WorkforceContext> {
  const to = opts.to ?? new Date();
  const { rules, holidays } = await loadRules();

  const [workers, attendance, lines, entries, advances, deductions, postingLines, components] = await Promise.all([
    prisma.worker.findMany({ select: workerSelect, orderBy: [{ name: 'asc' }] }),
    prisma.attendance.findMany({ orderBy: { date: 'asc' } }),
    prisma.orderLine.findMany({
      where: { order: { status: { not: 'Cancelled' } } },
      include: {
        order: { select: { id: true, number: true } },
        product: { select: { factoryCode: true, name: true } },
        stages: { orderBy: { sortOrder: 'asc' } },
        moves: { include: { workers: true } },
      },
    }),
    prisma.ledgerEntry.findMany({ where: { partyType: { in: ['WORKER', 'CONTRACTOR', 'STATUTORY'] } }, orderBy: [{ date: 'asc' }, { id: 'asc' }] }),
    prisma.workerAdvance.findMany({ orderBy: [{ date: 'asc' }, { id: 'asc' }] }),
    prisma.workerDeduction.findMany({ orderBy: [{ date: 'asc' }, { id: 'asc' }] }),
    prisma.statutoryPostingLine.findMany({ include: { posting: { select: { number: true, postedOn: true, periodFrom: true, periodTo: true } }, component: { select: { code: true, name: true } } } }),
    prisma.statutoryComponent.findMany({ orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] }),
  ]);

  // --- piece work off the board, grouped by worker --------------------------
  const pieceByWorker = new Map<number, EarningEvent[]>();
  for (const line of lines) {
    for (const e of labourEvents(line.order, line as never)) {
      const list = pieceByWorker.get(e.workerId) ?? [];
      list.push(e);
      pieceByWorker.set(e.workerId, list);
    }
  }

  const attByWorker = new Map<number, typeof attendance>();
  for (const a of attendance) {
    const list = attByWorker.get(a.workerId) ?? [];
    list.push(a);
    attByWorker.set(a.workerId, list);
  }

  // --- one account per worker ----------------------------------------------
  const accounts = new Map<number, WorkerAccount>();
  for (const worker of workers) {
    const from = accrualStart(worker);

    const earnings: EarningEvent[] = [
      ...attendanceEarnings(worker, attByWorker.get(worker.id) ?? [], from, to, rules, holidays),
      ...(pieceByWorker.get(worker.id) ?? []),
      // Wages typed in before this module existed stay part of what was owed.
      ...entries
        .filter((e) => e.partyType === 'WORKER' && e.kind === 'BILL' && e.workerId === worker.id)
        .map((e) => ({
          key: `manual-${e.id}`,
          workerId: worker.id,
          date: new Date(e.date),
          kind: 'MANUAL' as const,
          label: e.note || 'Wages recorded by hand',
          days: 0,
          hours: 0,
          pieces: 0,
          rate: 0,
          amount: e.amount,
          overtime: false,
        })),
    ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const myAdvances = advances
      .filter((a) => a.workerId === worker.id)
      .map((a) => ({ id: a.id, date: a.date, amount: a.amount, recoveryPerMonth: a.recoveryPerMonth, note: a.note, ref: a.ref }));

    const myPayments = entries
      // Advance cash lives on its own ledger row; counting it here as well as through
      // the advance would take the money out twice.
      .filter((e) => e.partyType === 'WORKER' && e.kind === 'PAYMENT' && e.workerId === worker.id && e.advanceId == null)
      .map((e) => ({ id: e.id, date: e.date, amount: e.amount, label: e.note || 'Wages paid', ref: e.ref, note: e.note }));

    const myDeductions = deductions.filter((d) => d.workerId === worker.id).map((d) => ({ id: d.id, date: d.date, amount: d.amount, label: d.reason }));

    const myStatutory = postingLines
      .filter((l) => l.workerId === worker.id && l.employeeAmt > 0)
      .map((l) => ({ id: l.id, date: l.posting.postedOn, amount: l.employeeAmt, label: `${l.component.code} — employee share` }));

    accounts.set(worker.id, {
      worker,
      earnings,
      deductions: myDeductions,
      statutory: myStatutory,
      advances: myAdvances,
      payments: myPayments,
      position: workerPosition({ workerId: worker.id, earnings, deductions: myDeductions, statutory: myStatutory, advances: myAdvances, payments: myPayments }),
    });
  }

  // --- who is a payable party ----------------------------------------------
  const directWorkers = [...accounts.values()].filter((a) => a.worker.contractorId == null);

  const contractorRows = await prisma.contractor.findMany({ orderBy: { name: 'asc' } });
  const contractors: ContractorAccount[] = contractorRows.map((c) => {
    const mine = [...accounts.values()].filter((a) => a.worker.contractorId === c.id);
    const accrued = round(mine.reduce((a, x) => a + x.position.earned, 0));
    const deducted = round(mine.reduce((a, x) => a + x.position.deducted, 0));
    const statutoryDeducted = round(mine.reduce((a, x) => a + x.position.statutoryDeducted, 0));
    const advanced = round(mine.reduce((a, x) => a + x.position.advanced, 0));
    const paid = sum(entries.filter((e) => e.partyType === 'CONTRACTOR' && e.kind === 'PAYMENT' && e.contractorId === c.id));
    return {
      contractor: { id: c.id, code: c.code, name: c.name, phone: c.phone, gstNo: c.gstNo, paymentTerms: c.paymentTerms },
      workers: mine,
      accrued,
      deducted,
      statutoryDeducted,
      advanced,
      paid,
      balance: round(accrued - deducted - statutoryDeducted - advanced - paid),
    };
  });

  // --- wage rows still keyed to a typed name -------------------------------
  const legacy = entries.filter((e) => e.partyType === 'WORKER' && e.workerId == null);
  const unlinked = [...new Set(legacy.map((e) => e.partyName))].map((partyName) => {
    const mine = legacy.filter((e) => e.partyName === partyName);
    const billed = sum(mine.filter((e) => e.kind === 'BILL'));
    const paid = sum(mine.filter((e) => e.kind === 'PAYMENT'));
    return { partyName, billed, paid, balance: round(billed - paid) };
  });

  // --- statutory liability, only what has been posted ----------------------
  const statutory: StatutoryDue[] = components.map((c) => {
    const mine = postingLines.filter((l) => l.componentId === c.id);
    const employee = round(mine.reduce((a, l) => a + l.employeeAmt, 0));
    const employer = round(mine.reduce((a, l) => a + l.employerAmt, 0));
    const accrued = round(employee + employer);
    const paid = sum(entries.filter((e) => e.partyType === 'STATUTORY' && e.kind === 'PAYMENT' && e.statutoryComponentId === c.id));
    return {
      componentId: c.id,
      code: c.code,
      name: c.name,
      payeeName: c.payeeName,
      isProvision: c.isProvision,
      employee,
      employer,
      accrued,
      paid,
      balance: round(accrued - paid),
      workers: new Set(mine.map((l) => l.workerId)).size,
    };
  });

  return { rules, holidays, accounts, directWorkers, contractors, unlinked, components, statutory, to };
}

// ---------------------------------------------------------------------------
// Totals shared with the dashboard and the payables page
// ---------------------------------------------------------------------------

export interface WorkforceTotals {
  headcount: number;
  contractorCount: number;
  wagesAccrued: number;
  wagesPaid: number;
  /** Owed to directly-paid workers, overpayment clamped out. */
  workerDue: number;
  contractorDue: number;
  advanceOutstanding: number;
  /** Posted statutory liability that is a real payable (provisions excluded). */
  statutoryDue: number;
  statutoryProvision: number;
  /** Everything the workforce is owed — what the payables total should include. */
  payableInr: number;
}

export function workforceTotals(ctx: WorkforceContext): WorkforceTotals {
  const clamp = (v: number) => round(Math.max(v, 0));
  const workerDue = round([...ctx.directWorkers].reduce((a, w) => a + clamp(w.position.balance), 0));
  const contractorDue = round(ctx.contractors.reduce((a, c) => a + clamp(c.balance), 0));
  const statutoryDue = round(ctx.statutory.filter((s) => !s.isProvision).reduce((a, s) => a + clamp(s.balance), 0));
  const statutoryProvision = round(ctx.statutory.filter((s) => s.isProvision).reduce((a, s) => a + clamp(s.balance), 0));
  const unlinkedDue = round(ctx.unlinked.reduce((a, u) => a + clamp(u.balance), 0));

  const all = [...ctx.accounts.values()];
  return {
    headcount: all.filter((a) => a.worker.isActive).length,
    contractorCount: ctx.contractors.length,
    wagesAccrued: round(all.reduce((a, w) => a + w.position.earned, 0)),
    wagesPaid: round(all.reduce((a, w) => a + w.position.paid + w.position.advanced, 0) + ctx.contractors.reduce((a, c) => a + c.paid, 0)),
    workerDue,
    contractorDue,
    advanceOutstanding: round(all.reduce((a, w) => a + w.position.advanceOutstanding, 0)),
    statutoryDue,
    statutoryProvision,
    payableInr: round(workerDue + contractorDue + statutoryDue + unlinkedDue),
  };
}

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

/**
 * A worker's running statement.
 *
 * Charges are what they earned; settlements are cash paid, advances handed over and
 * anything charged back to them. The closing balance is therefore the party balance —
 * negative when they are carrying an advance they have not yet worked off.
 */
export function workerStatement(account: WorkerAccount): StatementRow[] {
  const rows: Omit<StatementRow, 'balance' | 'key'>[] = [
    ...account.earnings.map((e) => ({
      date: e.date,
      type: 'ACCRUAL' as const,
      description: e.kind === 'PIECE' ? `${e.label} — ${e.orderNumber ?? ''}`.trim() : e.label,
      ref: e.orderNumber ?? null,
      orderNumber: e.orderNumber ?? null,
      charge: e.amount,
      settle: 0,
      detail:
        e.kind === 'PIECE'
          ? `${e.pieces} × ₹${e.rate}/pc`
          : e.kind === 'OT'
            ? `${e.hours} h × ₹${e.rate}/h`
            : e.kind === 'MANUAL'
              ? 'Recorded before Manforce'
              : `${e.days} day × ₹${e.rate}`,
    })),
    ...account.deductions.map((d) => ({ date: d.date, type: 'PAYMENT' as const, description: `Deduction — ${d.label}`, ref: null, orderNumber: null, charge: 0, settle: d.amount, detail: 'Charged to the worker' })),
    ...account.statutory.map((s) => ({ date: s.date, type: 'PAYMENT' as const, description: s.label, ref: null, orderNumber: null, charge: 0, settle: s.amount, detail: 'Deducted and paid to the authority' })),
    ...account.advances.map((a) => ({
      date: a.date,
      type: 'PAYMENT' as const,
      description: 'Advance paid',
      ref: a.ref ?? null,
      orderNumber: null,
      charge: 0,
      settle: a.amount,
      detail: a.recoveryPerMonth > 0 ? `Recovered at ₹${a.recoveryPerMonth}/month` : 'Recovered from earnings as they accrue',
    })),
    ...account.payments.map((p) => ({ date: p.date, type: 'PAYMENT' as const, description: p.label, ref: p.ref ?? null, orderNumber: null, charge: 0, settle: p.amount, detail: null })),
  ];
  return buildStatement(rows);
}

/**
 * A contractor's statement, one row per worker per month.
 *
 * The gang's day-by-day detail lives on each worker's own page; what the contractor
 * needs is the total they earned and how it was settled.
 */
export function contractorStatement(account: ContractorAccount, payments: { id: number; date: Date | string; amount: number; ref?: string | null; note?: string | null }[]): StatementRow[] {
  const rows: Omit<StatementRow, 'balance' | 'key'>[] = [];

  for (const w of account.workers) {
    const byMonth = new Map<string, { amount: number; days: number; pieces: number }>();
    for (const e of w.earnings) {
      const key = monthKey(e.date);
      const row = byMonth.get(key) ?? { amount: 0, days: 0, pieces: 0 };
      row.amount = round(row.amount + e.amount);
      row.days = round(row.days + e.days);
      row.pieces += e.pieces;
      byMonth.set(key, row);
    }
    for (const [month, row] of byMonth) {
      const [y, m] = month.split('-').map(Number);
      rows.push({
        date: new Date(y, m, 0),
        type: 'ACCRUAL',
        description: `${w.worker.name} — ${month}`,
        ref: w.worker.code,
        orderNumber: null,
        charge: row.amount,
        settle: 0,
        detail: [row.days ? `${row.days} day(s)` : null, row.pieces ? `${row.pieces} pc` : null].filter(Boolean).join(' · ') || null,
      });
    }
    for (const d of w.deductions) rows.push({ date: d.date, type: 'PAYMENT', description: `${w.worker.name} — deduction (${d.label})`, ref: w.worker.code, orderNumber: null, charge: 0, settle: d.amount, detail: null });
    for (const s of w.statutory) rows.push({ date: s.date, type: 'PAYMENT', description: `${w.worker.name} — ${s.label}`, ref: w.worker.code, orderNumber: null, charge: 0, settle: s.amount, detail: null });
    for (const a of w.advances) rows.push({ date: a.date, type: 'PAYMENT', description: `${w.worker.name} — advance`, ref: a.ref ?? w.worker.code, orderNumber: null, charge: 0, settle: a.amount, detail: null });
  }

  for (const p of payments) rows.push({ date: p.date, type: 'PAYMENT', description: p.note || 'Payment to contractor', ref: p.ref ?? null, orderNumber: null, charge: 0, settle: p.amount, detail: null });

  return buildStatement(rows);
}

// ---------------------------------------------------------------------------
// Statutory posting
// ---------------------------------------------------------------------------

export interface StatutoryPreviewLine {
  workerId: number;
  code: string;
  name: string;
  contractorName: string | null;
  componentId: number;
  componentCode: string;
  wages: number;
  employeeAmt: number;
  employerAmt: number;
  covered: boolean;
  reason?: string;
  /** Already posted for this component and worker inside the requested period. */
  alreadyPosted: boolean;
}

/**
 * What a posting for this period WOULD create, worked out from the wages actually
 * earned in it. Nothing exists in the accounts until it is posted.
 */
export async function statutoryPreview(from: Date, to: Date, componentIds?: number[]): Promise<{ lines: StatutoryPreviewLine[]; components: StatutoryComponentDef[] }> {
  const ctx = await buildWorkforceContext({ to });
  const covers = await prisma.workerStatutory.findMany();
  const posted = await prisma.statutoryPostingLine.findMany({
    where: { posting: { periodFrom: { lte: to }, periodTo: { gte: from } } },
    select: { componentId: true, workerId: true },
  });
  const postedKeys = new Set(posted.map((p) => `${p.componentId}:${p.workerId}`));

  const wanted = ctx.components.filter((c) => c.isActive !== false && (!componentIds?.length || componentIds.includes(c.id)));
  const lines: StatutoryPreviewLine[] = [];

  for (const account of ctx.accounts.values()) {
    // Only wages earned inside the period count towards this period's liability.
    const inPeriod = account.earnings.filter((e) => new Date(e.date) >= from && new Date(e.date) <= to);
    const base = wageBase(inPeriod);
    for (const c of wanted) {
      const covered = covers.some((x) => x.workerId === account.worker.id && x.componentId === c.id && x.covered);
      const result = covered ? computeStatutory(c, base) : { componentId: c.id, code: c.code, wages: 0, employeeAmt: 0, employerAmt: 0, covered: false, reason: 'Worker is not covered by this component.' };
      lines.push({
        workerId: account.worker.id,
        code: account.worker.code,
        name: account.worker.name,
        contractorName: account.worker.contractor?.name ?? null,
        componentId: c.id,
        componentCode: c.code,
        wages: result.wages,
        employeeAmt: result.employeeAmt,
        employerAmt: result.employerAmt,
        covered: result.covered,
        reason: result.reason,
        alreadyPosted: postedKeys.has(`${c.id}:${account.worker.id}`),
      });
    }
  }

  return { lines, components: wanted };
}
