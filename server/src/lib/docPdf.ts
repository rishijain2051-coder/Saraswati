/**
 * PDF generation for the proforma invoice, using pdfkit.
 *
 * The built-in Helvetica font can only encode WinAnsi, so all text goes through
 * `safe()` first — that keeps rupee signs, smart quotes and dashes from turning
 * into garbage. Money is printed with the currency CODE (e.g. "USD 1,200.00")
 * rather than a symbol for the same reason, which is also what buyers expect on
 * an export document.
 */
import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { companyLines, company } from './company';

const uploadDir = path.join(__dirname, '..', '..', 'uploads');

const REPLACEMENTS: [RegExp, string][] = [
  [/₹/g, 'INR '],
  [/[‘’‛]/g, "'"],
  [/[“”‟]/g, '"'],
  [/[–—]/g, '-'],
  [/…/g, '...'],
  [/ /g, ' '],
  [/[•●]/g, '*'],
];

/** Make a string safe for pdfkit's standard (WinAnsi) fonts. */
export function safe(input: unknown): string {
  let s = input == null ? '' : String(input);
  for (const [re, to] of REPLACEMENTS) s = s.replace(re, to);
  // Drop anything WinAnsi cannot represent rather than emitting mojibake.
  return s.replace(/[^\n\r\t\x20-\x7e\u00a0-\u00ff]/g, '');
}

export function amount(value: number | null | undefined, code = 'INR', dp = 2): string {
  if (value == null || !isFinite(value)) return '-';
  return `${code} ${value.toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '-';
  const date = new Date(d);
  if (isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Absolute path of an uploaded image, if pdfkit can actually embed it. */
function embeddablePath(filename?: string | null): string | null {
  if (!filename) return null;
  if (!/\.(jpe?g|png)$/i.test(filename)) return null; // pdfkit supports JPEG + PNG only
  const p = path.join(uploadDir, filename);
  return fs.existsSync(p) ? p : null;
}

const BROWN = '#4e342e';
const LIGHT = '#efebe9';
const GREY = '#777777';
const BORDER = '#cccccc';

type Doc = PDFKit.PDFDocument;

interface Col {
  key: string;
  title: string;
  width: number;
  align?: 'left' | 'right' | 'center';
}

/**
 * Start collecting the document's bytes. Call this BEFORE drawing so no chunk is
 * missed, then `await finish(doc, collected)` once the last element is drawn —
 * `doc.end()` must not run until the drawing is complete.
 */
function collect(doc: Doc): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
}

function finish(doc: Doc, collected: Promise<Buffer>): Promise<Buffer> {
  doc.end();
  return collected;
}

function letterhead(doc: Doc, title: string, number: string, date: Date | string) {
  const top = doc.y;
  doc.font('Helvetica-Bold').fontSize(19).fillColor(BROWN).text(safe(company.name), { continued: false });
  doc.font('Helvetica').fontSize(8.5).fillColor(GREY);
  for (const line of companyLines()) doc.text(safe(line));

  const right = doc.page.width - doc.page.margins.right - 200;
  doc.font('Helvetica-Bold').fontSize(14).fillColor('#000000').text(safe(title), right, top, { width: 200, align: 'right' });
  doc.font('Helvetica').fontSize(10).text(safe(number), right, doc.y, { width: 200, align: 'right' });
  doc.fontSize(9).fillColor(GREY).text(fmtDate(date), right, doc.y, { width: 200, align: 'right' });

  doc.fillColor('#000000');
  doc.y = Math.max(doc.y, top + 62) + 10;
  doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor(BROWN).lineWidth(1.2).stroke();
  doc.y += 12;
}

/** Two facing blocks: party on the left, key/value terms on the right. */
function partyBlock(doc: Doc, heading: string, lines: string[], terms: [string, string][]) {
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const half = width / 2 - 10;
  const top = doc.y;

  doc.font('Helvetica').fontSize(7.5).fillColor(GREY).text(heading, left, top, { width: half });
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#000000').text(safe(lines[0] ?? '-'), left, doc.y, { width: half });
  doc.font('Helvetica').fontSize(9);
  for (const l of lines.slice(1)) if (l) doc.text(safe(l), left, doc.y, { width: half });
  const leftEnd = doc.y;

  let y = top;
  const rx = left + width - half;
  for (const [k, v] of terms) {
    if (!v) continue;
    doc.font('Helvetica').fontSize(8.5).fillColor(GREY).text(safe(k), rx, y, { width: half * 0.45 });
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#000000').text(safe(v), rx + half * 0.45, y, { width: half * 0.55, align: 'right' });
    y = Math.max(y + 13, doc.y);
  }

  doc.y = Math.max(leftEnd, y) + 14;
  doc.fillColor('#000000');
}

function tableHeader(doc: Doc, cols: Col[], y: number): number {
  const left = doc.page.margins.left;
  const h = 20;
  const total = cols.reduce((a, c) => a + c.width, 0);
  doc.rect(left, y, total, h).fill(LIGHT);
  let x = left;
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(BROWN);
  for (const c of cols) {
    doc.text(safe(c.title), x + 5, y + 6, { width: c.width - 10, align: c.align ?? 'left' });
    x += c.width;
  }
  doc.fillColor('#000000');
  return y + h;
}

function hline(doc: Doc, y: number, width: number) {
  doc.moveTo(doc.page.margins.left, y).lineTo(doc.page.margins.left + width, y).strokeColor(BORDER).lineWidth(0.6).stroke();
}

// ---------------------------------------------------------------------------
// Proforma invoice
// ---------------------------------------------------------------------------

export interface ProformaPdfLine {
  description: string;
  qty: number;
  unitPrice: number;
  productCode?: string | null;
  imageFile?: string | null;
  specs?: string | null;
}

export interface ProformaPdfInput {
  number: string;
  date: Date | string;
  validUntil?: Date | string | null;
  currencyCode: string;
  showImages: boolean;
  buyer: { name: string; address?: string | null; country?: string | null; contactName?: string | null; email?: string | null; phone?: string | null };
  incoterms?: string | null;
  paymentTerms?: string | null;
  deliveryTerms?: string | null;
  bankDetails?: string | null;
  notes?: string | null;
  lines: ProformaPdfLine[];
}

export async function proformaPdf(input: ProformaPdfInput): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margins: { top: 40, bottom: 46, left: 40, right: 40 } });
  const out = collect(doc);
  const code = input.currencyCode || 'INR';
  const withImages = input.showImages && input.lines.some((l) => embeddablePath(l.imageFile));

  letterhead(doc, 'PROFORMA INVOICE', input.number, input.date);

  partyBlock(
    doc,
    'BUYER',
    [input.buyer.name, input.buyer.contactName ? `Attn: ${input.buyer.contactName}` : '', ...(input.buyer.address ? input.buyer.address.split('\n') : []), input.buyer.country ?? '', input.buyer.email ?? '', input.buyer.phone ?? ''].filter(
      Boolean
    ) as string[],
    [
      ['Currency', code],
      ['Incoterms', input.incoterms ?? ''],
      ['Valid until', input.validUntil ? fmtDate(input.validUntil) : ''],
    ]
  );

  const usable = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const imgW = withImages ? 62 : 0;
  const cols: Col[] = [
    { key: 'i', title: '#', width: 24 },
    ...(withImages ? [{ key: 'img', title: '', width: imgW } as Col] : []),
    { key: 'desc', title: 'Description', width: usable - 24 - imgW - 50 - 84 - 92 },
    { key: 'qty', title: 'Qty', width: 50, align: 'right' },
    { key: 'rate', title: 'Unit Price', width: 84, align: 'right' },
    { key: 'amt', title: 'Amount', width: 92, align: 'right' },
  ];
  const totalW = cols.reduce((a, c) => a + c.width, 0);
  const descCol = cols.find((c) => c.key === 'desc')!;

  let y = tableHeader(doc, cols, doc.y);
  const bottomLimit = () => doc.page.height - doc.page.margins.bottom - 30;

  let total = 0;
  input.lines.forEach((l, idx) => {
    const img = withImages ? embeddablePath(l.imageFile) : null;
    const descText = safe(l.description) + (l.productCode ? `\n${safe(l.productCode)}` : '') + (l.specs ? `\n${safe(l.specs)}` : '');
    doc.font('Helvetica').fontSize(9);
    const textH = doc.heightOfString(descText, { width: descCol.width - 10 });
    const rowH = Math.max(withImages ? 52 : 0, textH + 12);

    if (y + rowH > bottomLimit()) {
      doc.addPage();
      y = tableHeader(doc, cols, doc.page.margins.top);
    }

    const amt = l.qty * l.unitPrice;
    total += amt;

    let x = doc.page.margins.left;
    const cell = (c: Col, text: string, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor('#000000');
      doc.text(text, x + 5, y + 6, { width: c.width - 10, align: c.align ?? 'left' });
    };

    for (const c of cols) {
      if (c.key === 'i') cell(c, String(idx + 1));
      else if (c.key === 'img') {
        if (img) {
          try {
            doc.image(img, x + 5, y + 5, { fit: [c.width - 10, rowH - 10], align: 'center', valign: 'center' });
          } catch {
            /* unreadable image — leave the cell blank rather than fail the PDF */
          }
        }
      } else if (c.key === 'desc') cell(c, descText);
      else if (c.key === 'qty') cell(c, String(l.qty));
      else if (c.key === 'rate') cell(c, amount(l.unitPrice, code));
      else cell(c, amount(amt, code), true);
      x += c.width;
    }

    y += rowH;
    hline(doc, y, totalW);
  });

  // Totals
  const labelW = totalW - 92;
  doc.rect(doc.page.margins.left, y, totalW, 22).fill(LIGHT);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(BROWN);
  doc.text('TOTAL', doc.page.margins.left + 5, y + 6, { width: labelW - 10, align: 'right' });
  doc.text(amount(total, code), doc.page.margins.left + labelW, y + 6, { width: 87, align: 'right' });
  doc.fillColor('#000000');
  y += 34;
  doc.y = y;

  // Terms + bank details
  const half = usable / 2 - 10;
  const termsTop = doc.y;
  const terms: [string, string][] = [
    ['Payment terms', input.paymentTerms ?? ''],
    ['Delivery terms', input.deliveryTerms ?? ''],
    ['Incoterms', input.incoterms ?? ''],
  ];
  doc.font('Helvetica').fontSize(9);
  for (const [k, v] of terms) {
    if (!v) continue;
    doc.font('Helvetica-Bold').fontSize(8.5).text(safe(k), doc.page.margins.left, doc.y, { width: half });
    doc.font('Helvetica').fontSize(9).text(safe(v), doc.page.margins.left, doc.y, { width: half });
    doc.y += 3;
  }
  if (input.notes) {
    doc.font('Helvetica-Bold').fontSize(8.5).text('Notes', doc.page.margins.left, doc.y + 4, { width: half });
    doc.font('Helvetica').fontSize(9).text(safe(input.notes), doc.page.margins.left, doc.y, { width: half });
  }
  const leftEnd = doc.y;

  if (input.bankDetails) {
    const rx = doc.page.margins.left + usable - half;
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(GREY).text('BANK DETAILS', rx, termsTop, { width: half, align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor('#000000').text(safe(input.bankDetails), rx, doc.y, { width: half, align: 'right' });
  }

  doc.y = Math.max(leftEnd, doc.y) + 34;
  if (doc.y > bottomLimit()) doc.addPage();
  doc.font('Helvetica').fontSize(9).text(`For ${safe(company.name)}`, doc.page.margins.left + usable - 200, doc.y, { width: 200, align: 'right' });
  doc.fillColor(GREY).text('Authorised Signatory', doc.page.margins.left + usable - 200, doc.y + 26, { width: 200, align: 'right' });

  return finish(doc, out);
}
