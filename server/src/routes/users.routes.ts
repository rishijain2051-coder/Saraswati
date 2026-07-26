import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { asyncHandler } from '../lib/http';
import { authenticate, requireRole, ROLES } from '../middleware/auth';
import { hashPassword } from '../lib/auth';

const router = Router();
router.use(authenticate, requireRole('Admin'));

const select = { id: true, name: true, email: true, role: true, isActive: true, createdAt: true } as const;

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({ select, orderBy: { name: 'asc' } });
    res.json(users);
  })
);

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(ROLES),
});

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const data = createSchema.parse(req.body);
    const user = await prisma.user.create({
      data: {
        name: data.name,
        email: data.email.toLowerCase(),
        role: data.role,
        passwordHash: await hashPassword(data.password),
      },
      select,
    });
    res.status(201).json(user);
  })
);

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.enum(ROLES).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(6).optional(),
});

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const data = updateSchema.parse(req.body);
    const user = await prisma.user.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.role !== undefined ? { role: data.role } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        ...(data.password ? { passwordHash: await hashPassword(data.password) } : {}),
      },
      select,
    });
    res.json(user);
  })
);

export default router;
