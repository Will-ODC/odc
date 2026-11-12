import { z } from "zod";
export const MIN_SAVINGS_PERCENT = 20;
const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .refine(
      (s) =>
        [...s].length <= max &&
        !s.includes("\0") &&
        !/[\uD800-\uDFFF]/u.test(s),
    );
const url = text(2000).refine((s) => {
  try {
    const u = new URL(s);
    return (
      ["http:", "https:"].includes(u.protocol) && !u.username && !u.password
    );
  } catch {
    return false;
  }
});
export const statusSchema = z.enum([
  "open",
  "in_progress",
  "completed",
  "cancelled",
]);
const commercial = z
  .object({
    currency: z.enum(["CAD", "USD", "GBP", "EUR"]),
    regularPriceMinor: z.number().int().min(1).max(1_000_000_000),
    offeredPriceMinor: z.number().int().min(0).max(1_000_000_000),
    referenceUrl: url,
    terms: text(2000),
  })
  .strict()
  .refine(
    (v) =>
      v.offeredPriceMinor * 100 <=
      v.regularPriceMinor * (100 - MIN_SAVINGS_PERCENT),
  );
export const creationSchema = z
  .object({
    title: text(160),
    description: text(4000),
    communityBenefit: text(2000).or(z.literal("")).default(""),
    needs: text(2000).or(z.literal("")).default(""),
    organizerName: text(80),
    kind: z.enum(["project", "fundraiser", "group_buy", "offer"]),
    pollId: text(128)
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    commercial: commercial
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    fund: z
      .object({ name: text(160), percentage: z.number().int().min(1).max(100) })
      .strict()
      .nullable()
      .optional()
      .transform((v) => v ?? null),
  })
  .strict()
  .refine((v) => {
    const isCommercial = v.kind === "group_buy" || v.kind === "offer";
    if (!isCommercial) return v.commercial === null && v.fund === null;
    return v.fund === null || v.commercial !== null;
  });
export const participationSchema = z
  .object({
    displayName: text(80),
    kind: z.enum(["help", "pledge", "report"]),
    message: text(2000),
  })
  .strict();
export const messageSchema = z.object({ message: text(2000) }).strict();
export const updateSchema = z
  .object({
    message: text(2000),
    status: statusSchema,
    evidenceUrl: url
      .nullable()
      .optional()
      .transform((v) => v ?? null),
  })
  .strict();
export type ContributionInput = z.infer<typeof creationSchema>;
export type ParticipationInput = z.infer<typeof participationSchema>;
export type UpdateInput = z.infer<typeof updateSchema>;
export type ContributionStatus = z.infer<typeof statusSchema>;
export class ContributionError extends Error {
  constructor(
    readonly code:
      | "bad_request"
      | "signed_out"
      | "organizer_required"
      | "not_found"
      | "poll_not_found"
      | "idempotency_conflict"
      | "posting_limit"
      | "closed"
      | "record_full",
  ) {
    super(code);
    this.name = "ContributionError";
  }
}
export function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ContributionError("bad_request");
  return result.data;
}
export function requestKey(value: string): string {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new ContributionError("bad_request");
  return value.toLowerCase();
}
export interface ListQuery {
  before?: { createdAt: string; id: string };
}
export function listQuery(raw: unknown): ListQuery {
  const q = parse(
    z.object({ cursor: z.string().min(1).max(1024).optional() }).strict(),
    raw,
  );
  if (!q.cursor) return {};
  try {
    const data = Buffer.from(q.cursor, "base64url");
    if (data.toString("base64url") !== q.cursor) throw new Error();
    return {
      before: parse(
        z
          .object({ createdAt: z.iso.datetime({ precision: 3 }), id: z.uuid() })
          .strict(),
        JSON.parse(data.toString("utf8")),
      ),
    };
  } catch {
    throw new ContributionError("bad_request");
  }
}
