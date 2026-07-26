import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

/** Application error with an HTTP status code. */
export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/** Wrap an async route handler so thrown/rejected errors reach the error middleware. */
export const asyncHandler =
  <T extends Request>(fn: (req: T, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req as T, res, next)).catch(next);
  };

/** Central error handler. */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation failed',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  // Prisma unique-constraint violation
  if (typeof err === 'object' && err && (err as any).code === 'P2002') {
    const target = (err as any).meta?.target;
    return res.status(409).json({ error: `A record with this ${Array.isArray(target) ? target.join(', ') : target} already exists.` });
  }
  console.error('[unhandled error]', err);
  const message = err instanceof Error ? err.message : 'Internal server error';
  return res.status(500).json({ error: message });
}
