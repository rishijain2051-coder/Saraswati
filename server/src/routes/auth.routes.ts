import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { ApiError, asyncHandler } from '../lib/http';
import { signToken, verifyPassword } from '../lib/auth';
import { authenticate } from '../middleware/auth';

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user || !user.isActive) throw new ApiError(401, 'Invalid email or password.');
    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) throw new ApiError(401, 'Invalid email or password.');

    const token = signToken({ sub: user.id, role: user.role, name: user.name, email: user.email });
    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  })
);

router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.sub } });
    if (!user || !user.isActive) throw new ApiError(401, 'Account not found or disabled.');
    res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
  })
);

export default router;
