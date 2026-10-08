import { BadRequestException } from "@nestjs/common";
import { z } from "zod";

const text = (max: number) => z.string().max(max);
const milestone = z
  .object({
    name: text(100),
    amount: text(30),
    scope: text(2000),
    criteria: text(2000),
    dueDate: text(10),
  })
  .strict();
export const draftSchema = z
  .object({
    title: text(100),
    description: text(2000),
    exclusions: text(2000),
    revisions: z.number().int().min(0).max(10),
    reviewDays: z.number().int().min(1).max(30),
    milestones: z.array(milestone).min(1).max(10),
  })
  .strict();
export const agreementSchema = draftSchema.superRefine((value, context) => {
  const error = (path: (string | number)[], message: string) =>
    context.addIssue({ code: "custom", path, message });
  for (const key of ["title", "description", "exclusions"] as const)
    if (!value[key].trim()) error([key], "Required");
  value.milestones.forEach((item, i) => {
    for (const key of ["name", "scope", "criteria"] as const)
      if (!item[key].trim()) error(["milestones", i, key], "Required");
    if (
      !/^\d{1,7}(\.\d{1,2})?$/.test(item.amount) ||
      toCents(item.amount) < 1n ||
      toCents(item.amount) > 100000000n
    )
      error(
        ["milestones", i, "amount"],
        "Use 0.01–1,000,000 USDC with at most two decimals",
      );
    const date = new Date(item.dueDate + "T00:00:00Z");
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(item.dueDate) ||
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== item.dueDate
    )
      error(["milestones", i, "dueDate"], "Choose a valid date");
  });
});
// Decimal strings remain strings in storage. Integer base units avoid float arithmetic.
function toCents(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}
export const registerSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(12).max(128),
  })
  .strict();
export const loginSchema = registerSchema.omit({ name: true });
export const createSchema = z
  .object({
    counterpartyId: z.string().uuid(),
    role: z.enum(["client", "freelancer"]),
    agreement: draftSchema,
  })
  .strict();
export const saveSchema = z
  .object({
    agreement: draftSchema,
    expectedVersion: z.number().int().min(0),
    expectedRevision: z.number().int().min(0),
  })
  .strict();
export const publishSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    expectedRevision: z.number().int().positive(),
  })
  .strict();
export const acceptSchema = z
  .object({ version: z.number().int().positive() })
  .strict();
export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new BadRequestException({
      message: "Check the submitted fields.",
      errors: result.error.issues.map((item) => ({
        field: item.path.join("."),
        message: item.message,
      })),
    });
  return result.data;
}
export type User = { id: string; name: string; email: string };
