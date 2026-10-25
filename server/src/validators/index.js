import { z } from "zod";

const passwordSchema = z.string()
  .min(10)
  .max(72)
  .refine((value) => Buffer.byteLength(value, "utf8") <= 72, "Password must be at most 72 UTF-8 bytes");

export const documentCategorySchema = z.enum(["Finance", "Legal", "HR", "Operations", "Other"]);

export const registerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(254),
  password: passwordSchema,
  companyName: z.string().trim().min(2).max(120)
});

export const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(72)
});

export const permissionSchema = z.object({
  email: z.string().trim().email().max(254),
  level: z.enum(["view", "download", "edit"]),
  expiresAt: z.string().datetime().optional().nullable()
});

export const documentUpdateSchema = z.object({
  name: z.string().trim().min(1).max(255).refine((value) => !/[\\/\u0000-\u001f]/.test(value), "Document name contains invalid characters"),
  category: documentCategorySchema
}).partial().strict();

export const documentSearchSchema = z.object({
  name: z.string().trim().max(120).optional(),
  owner: z.string().trim().max(120).optional(),
  category: documentCategorySchema.optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional()
}).strict().refine((filters) => !filters.dateFrom || !filters.dateTo || filters.dateFrom <= filters.dateTo, {
  message: "dateFrom must not be after dateTo"
});

export const inviteSchema = z.object({
  email: z.string().trim().email().max(254),
  role: z.enum(["owner", "viewer"])
});

export const acceptInviteSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(254),
  password: passwordSchema,
  invitationCode: z.string().min(32).max(128)
});
