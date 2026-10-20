import { z } from "zod";

export const pollIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const method = z.enum(["single", "approval"]);
export const pollSchema = z
  .object({
    id: pollIdSchema,
    question: z.string(),
    choices: z.array(z.string()).min(1),
    method,
    next: z.array(pollIdSchema.nullable()),
    acceptsSuggestions: z.boolean(),
    closesAt: z.iso.datetime().nullable(),
    open: z.boolean(),
  })
  .strip()
  .refine((p) => p.next.length === p.choices.length);
export const resultsSchema = z
  .object({
    pollId: pollIdSchema,
    question: z.string(),
    method,
    voters: z.number().int().nonnegative(),
    // Confirmed numbers (ADR-0040). Optional, so an upstream from before them
    // still reads; when present they are aggregates like the rest.
    confirmedVoters: z.number().int().nonnegative().optional(),
    choices: z.array(
      z
        .object({
          index: z.number().int().nonnegative(),
          label: z.string(),
          count: z.number().int().nonnegative(),
          share: z.number().min(0).max(100),
          confirmedCount: z.number().int().nonnegative().optional(),
          confirmedShare: z.number().min(0).max(100).optional(),
        })
        .strip(),
    ),
  })
  .strip()
  .refine((r) =>
    r.choices.every((c, i) => c.index === i && c.count <= r.voters),
  )
  .refine(
    (r) =>
      (r.confirmedVoters ?? 0) <= r.voters &&
      r.choices.every(
        (c) => (c.confirmedCount ?? 0) <= (r.confirmedVoters ?? 0),
      ),
  );

const messages = {
  invalid_link: "Use a poll id or a link from this Pulse website.",
  not_found: "There is no such poll.",
  unsupported_method: "This poll's answer method is not supported.",
  too_many_requests: "Too many tries just now. Try again later.",
  upstream_unavailable: "Pulse could not be reached. Try again.",
  upstream_invalid_response: "Pulse returned an unreadable answer.",
} as const;
export class ReadError extends Error {
  constructor(readonly code: keyof typeof messages) {
    super(messages[code]);
  }
}

/** Validate trusted configuration once; never derive an upstream from tool input. */
export function origin(raw: string): URL {
  const url = new URL(raw);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    )
  ) {
    throw new Error("MCP requires an HTTPS origin or a loopback HTTP origin.");
  }
  return url;
}

export function idFromLink(link: string, publicOrigin: URL): string {
  try {
    const url = new URL(link);
    const match = /^\/(?:api\/)?polls\/([A-Za-z0-9_-]{1,128})$/.exec(
      url.pathname,
    );
    if (
      url.origin !== publicOrigin.origin ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !match?.[1] ||
      link.includes("%") ||
      link.includes("\\")
    ) {
      throw new ReadError("invalid_link");
    }
    return match[1];
  } catch {
    throw new ReadError("invalid_link");
  }
}

export class PulseReads {
  constructor(
    private readonly base: URL,
    private readonly timeoutMs = 5000,
  ) {}

  async get(id: string, results = false) {
    try {
      const response = await fetch(
        new URL(`/api/polls/${id}${results ? "/results" : ""}`, this.base),
        {
          redirect: "manual",
          signal: AbortSignal.timeout(this.timeoutMs),
          headers: { accept: "application/json" },
        },
      );
      if (response.status === 404) {
        await response.body?.cancel();
        throw new ReadError("not_found");
      }
      if (response.status === 429) {
        await response.body?.cancel();
        throw new ReadError("too_many_requests");
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new ReadError("upstream_unavailable");
      }
      if (!response.headers.get("content-type")?.includes("application/json")) {
        await response.body?.cancel();
        throw new ReadError("upstream_invalid_response");
      }
      const reader = response.body?.getReader();
      if (!reader) throw new ReadError("upstream_invalid_response");
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 1024 * 1024) {
          await reader.cancel();
          throw new ReadError("upstream_invalid_response");
        }
        chunks.push(part.value);
      }
      const raw: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const parsed = (results ? resultsSchema : pollSchema).safeParse(raw);
      if (!parsed.success) {
        if (
          typeof raw === "object" &&
          raw !== null &&
          "method" in raw &&
          typeof raw.method === "string" &&
          !method.safeParse(raw.method).success
        ) {
          throw new ReadError("unsupported_method");
        }
        throw new ReadError("upstream_invalid_response");
      }
      const body = parsed.data;
      if (("id" in body ? body.id : body.pollId) !== id)
        throw new ReadError("upstream_invalid_response");
      return body;
    } catch (error) {
      if (error instanceof ReadError) throw error;
      if (error instanceof SyntaxError)
        throw new ReadError("upstream_invalid_response");
      throw new ReadError("upstream_unavailable");
    }
  }
}
