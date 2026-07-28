/**
 * Image upload plumbing, shared by product photos and hand-over shots.
 *
 * A declared mimetype is just a header the client chose, so it is not evidence: an
 * `.html` or `.exe` renamed and sent as `image/png` would pass a mimetype check and
 * then sit in a directory the browser fetches from. Every accepted file is therefore
 * re-opened and its magic bytes checked; anything that is not really a JPEG, PNG,
 * GIF or WebP is deleted before it can be referenced.
 */
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { nanoid } from 'nanoid';
import { ApiError } from './http';

export const uploadDir = path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

/** Build a multer instance writing into the uploads folder with a safe name. */
export function imageUploader(prefix: string) {
  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, uploadDir),
      filename: (_req, file, cb) => {
        // Never trust the client's filename — it can carry path separators or
        // a second extension. Only the extension is kept, and only a known one.
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, `${prefix}${Date.now()}-${nanoid(8)}${ALLOWED_EXT.has(ext) ? ext : '.bin'}`);
      },
    }),
    limits: { fileSize: 10 * 1024 * 1024, files: 20 },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, /^image\//.test(file.mimetype) && ALLOWED_EXT.has(ext));
    },
  });
}

/** True when the bytes on disk really are one of the formats we accept. */
function looksLikeImage(file: string): boolean {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(12);
    const read = fs.readSync(fd, head, 0, 12, 0);
    if (read < 12) return false;
    const jpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    const png = head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const gif = head.subarray(0, 6).toString('latin1') === 'GIF87a' || head.subarray(0, 6).toString('latin1') === 'GIF89a';
    const webp = head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP';
    return jpeg || png || gif || webp;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/**
 * Drop anything whose contents are not a real image and report it. Returns the files
 * that survived; throws when nothing usable was sent.
 */
export function keepRealImages(files: Express.Multer.File[]): Express.Multer.File[] {
  const good: Express.Multer.File[] = [];
  const rejected: string[] = [];
  for (const f of files) {
    if (looksLikeImage(f.path)) good.push(f);
    else {
      rejected.push(f.originalname);
      fs.promises.unlink(f.path).catch(() => undefined);
    }
  }
  if (good.length === 0) {
    throw new ApiError(400, rejected.length ? `Not a usable image: ${rejected.join(', ')}. Upload a JPEG, PNG, GIF or WebP.` : 'No images were uploaded.');
  }
  return good;
}
