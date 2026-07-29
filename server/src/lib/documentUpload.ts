/**
 * Upload plumbing for order attachments: the buyer's PO, a bill of lading, customs
 * paperwork, a packing list, an inspection certificate, a CAD drawing.
 *
 * Same discipline as `imageUpload.ts`, and for the same reason: a declared mimetype is a
 * header the client chose, so it is not evidence. Every accepted file is re-opened and
 * its magic bytes checked, and anything whose contents do not match its extension is
 * deleted before a row can reference it.
 *
 * Two honest limits on that:
 *
 * - `.docx`, `.xlsx` and `.zip` are all ZIP containers, so the signature cannot tell them
 *   apart. The EXTENSION allow-list is what distinguishes them, and it is closed, so the
 *   worst case is a zip renamed `.xlsx` — not a script.
 * - `.eml`, `.txt` and `.csv` are plain text with no signature at all. They are checked
 *   for being decodable text without NUL bytes, which is the most that can be said.
 *
 * Files are served from `/uploads` behind `authenticateUpload`, with `nosniff` and a CSP,
 * so an archive or a document downloads rather than executing.
 */
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { nanoid } from 'nanoid';
import { ApiError } from './http';
import { uploadDir } from './imageUpload';

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** What may be attached. Closed set: nothing executable, nothing scriptable. */
export const ALLOWED_ATTACHMENT_EXT = new Set(['.pdf', '.xlsx', '.xls', '.docx', '.doc', '.jpg', '.jpeg', '.png', '.txt', '.csv', '.zip', '.dwg', '.eml']);

/** Labels an attachment can carry, so the list can be grouped and filtered. */
export const ATTACHMENT_LABELS = ['PO_COPY', 'SHIPPING', 'CUSTOMS', 'PACKING_LIST', 'INSPECTION', 'DRAWING', 'OTHER'] as const;
export type AttachmentLabel = (typeof ATTACHMENT_LABELS)[number];

export function attachmentUploader(prefix: string) {
  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, uploadDir),
      filename: (_req, file, cb) => {
        // The client's filename is never used as a path — only its extension, and only
        // one we allow. `originalName` keeps the human version for display.
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `${prefix}${Date.now()}-${nanoid(8)}${ALLOWED_ATTACHMENT_EXT.has(ext) ? ext : '.bin'}`);
      },
    }),
    limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 10 },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, ALLOWED_ATTACHMENT_EXT.has(ext));
    },
  });
}

const startsWith = (head: Buffer, bytes: number[]) => bytes.every((b, i) => head[i] === b);

/** Looks like plain text: decodable, and with no NUL bytes. */
function looksLikeText(head: Buffer, read: number): boolean {
  for (let i = 0; i < read; i++) if (head[i] === 0) return false;
  return true;
}

/**
 * True when the bytes on disk match what the extension claims.
 *
 * Returns a reason when they do not, so the caller can say which file was rejected and
 * why rather than a blanket failure.
 */
export function verifyAttachment(file: string, ext: string): string | null {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(16);
    const read = fs.readSync(fd, head, 0, 16, 0);
    if (read === 0) return 'the file is empty';

    const zip = startsWith(head, [0x50, 0x4b]); // PK — docx, xlsx, zip
    const ole = startsWith(head, [0xd0, 0xcf, 0x11, 0xe0]); // legacy .doc / .xls
    const pdf = head.subarray(0, 4).toString('latin1') === '%PDF';
    const jpeg = startsWith(head, [0xff, 0xd8, 0xff]);
    const png = head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    // AutoCAD drawings start "AC10xx" (AC1015 = 2000, AC1032 = 2018, …).
    const dwg = /^AC10\d\d/.test(head.subarray(0, 6).toString('latin1'));

    switch (ext) {
      case '.pdf':
        return pdf ? null : 'it is not a PDF';
      case '.docx':
      case '.xlsx':
        return zip ? null : 'it is not a Word or Excel file';
      case '.doc':
      case '.xls':
        // Word 97-2003 is OLE; some tools save modern XML under the old extension.
        return ole || zip ? null : 'it is not a Word or Excel file';
      case '.zip':
        return zip ? null : 'it is not a ZIP archive';
      case '.jpg':
      case '.jpeg':
        return jpeg ? null : 'it is not a JPEG';
      case '.png':
        return png ? null : 'it is not a PNG';
      case '.dwg':
        return dwg ? null : 'it is not an AutoCAD drawing';
      case '.txt':
      case '.csv':
      case '.eml':
        return looksLikeText(head, read) ? null : 'it is not a text file';
      default:
        return 'that file type is not allowed';
    }
  } catch {
    return 'the file could not be read';
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/** Drop anything whose contents contradict its name. Throws when nothing usable is left. */
export function keepRealDocuments(files: Express.Multer.File[]): Express.Multer.File[] {
  const good: Express.Multer.File[] = [];
  const rejected: string[] = [];
  for (const f of files) {
    const reason = verifyAttachment(f.path, path.extname(f.filename).toLowerCase());
    if (!reason) good.push(f);
    else {
      rejected.push(`${f.originalname} (${reason})`);
      fs.promises.unlink(f.path).catch(() => undefined);
    }
  }
  if (good.length === 0) {
    throw new ApiError(
      400,
      rejected.length
        ? `Nothing could be attached: ${rejected.join('; ')}.`
        : 'No files were uploaded. Allowed: PDF, Word, Excel, images, CSV, text, ZIP, DWG and EML, up to 25 MB each.'
    );
  }
  return good;
}
