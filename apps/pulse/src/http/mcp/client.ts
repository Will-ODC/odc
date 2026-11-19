import { z } from "zod";

export const pollIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
/** A public-vote list cursor as the route seals it: opaque base64url. */
export const cursorSchema = z
  .string()
  .min(1)
  .max(2048)
  .regex(/^[A-Za-z0-9_-]+$/);
const method = z.enum(["single", "approval"]);
/**
 * Whether the poll's votes are anonymous or public (ADR-0048), passed on as
 * an optional strict field: a server from before it sends none, and any value
 * other than these two is refused whole rather than guessed at.
 */
const votePrivacy = z.enum(["anonymous", "public"]);
/**
 * Public authorship (ADR-0037), passed on only in its exact public shapes.
 * Unlike the outer poll, whose unknown keys are stripped, these inner objects
 * are strict: an upstream that puts anything else inside an attribution or a
 * community — an account id, an email — is answering with something other
 * than the public projection, so the whole body is refused as
 * `upstream_invalid_response` rather than quietly trimmed and trusted.
 */
const authorName = z
  .string()
  .refine((name) => name.trim() !== "" && [...name].length <= 80);
const attributionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("anonymous") }).strict(),
  z.object({ kind: z.literal("named"), name: authorName }).strict(),
]);
const communitySchema = z
  .object({ id: z.string().min(1), label: z.string().min(1) })
  .strict();
/**
 * The public picture (ADR-0047), strict like attribution: an upstream that
 * puts an uploader, a file name or a hash inside it is refused whole. Its
 * URLs are relative and can name only a stored variant of one picture.
 */
const pictureUrl = (variant: "display" | "thumb") =>
  z
    .string()
    .regex(
      new RegExp(
        `^/api/poll-images/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/${variant}\\.webp$`,
      ),
    );
const imageSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("upload"),
      displayUrl: pictureUrl("display"),
      thumbUrl: pictureUrl("thumb"),
      width: z.number().int().min(1).max(1600),
      height: z.number().int().min(1).max(1600),
      alt: z
        .string()
        .refine((alt) => alt.trim() !== "" && [...alt].length <= 300),
    })
    .strict(),
  z.object({ kind: z.literal("tile") }).strict(),
]);
export const pollSchema = z
  .object({
    id: pollIdSchema,
    question: z.string(),
    context: z.string().nullable().default(null),
    choices: z.array(z.string()).min(1),
    method,
    next: z.array(pollIdSchema.nullable()),
    acceptsSuggestions: z.boolean(),
    closesAt: z.iso.datetime().nullable(),
    open: z.boolean(),
    // Optional: seed and legacy polls, and servers from before ADR-0037,
    // send neither.
    community: communitySchema.optional(),
    attribution: attributionSchema.optional(),
    // Optional: servers from before ADR-0047 send none.
    image: imageSchema.optional(),
    votePrivacy: votePrivacy.optional(),
  })
  .strip()
  .refine((p) => p.next.length === p.choices.length);
export const resultsSchema = z
  .object({
    pollId: pollIdSchema,
    question: z.string(),
    method,
    voters: z.number().int().nonnegative(),
    votePrivacy: votePrivacy.optional(),
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

/**
 * One page of a public-vote poll's names and answers (ADR-0048 decisions 7
 * and 11). Each item is exactly `{ name, choices }`, strict like attribution:
 * an upstream that adds an email, an account id or a cast time to an entry is
 * not serving the public list, so the whole body is refused, never trimmed.
 * `name` is a profile name as the profile store bounds it, or null.
 */
export const publicVotesSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            name: authorName.nullable(),
            choices: z.array(z.number().int().nonnegative()).min(1),
          })
          .strict(),
      )
      .max(50),
    nextCursor: cursorSchema.nullable(),
  })
  .strip();

const messages = {
  invalid_link: "Use a poll id or a link from this Pulse website.",
  not_found: "There is no such poll.",
  anonymous_poll: "This poll's votes are anonymous, so no names are shown.",
  invalid_cursor:
    "That page of votes cannot be read. Start again without a cursor.",
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

/** Which public route a read uses; each has its own body shape. */
type Read =
  | { kind: "poll"; id: string }
  | { kind: "results"; id: string }
  | { kind: "publicVotes"; id: string; cursor?: string };

export class PulseReads {
  /**
   * `internal` is the per-process header that lets this server's own reads of
   * the public list past the list's per-address limit, because MCP counts the
   * real caller itself (ADR-0048 decision 7). It is sent only to this
   * server's loopback listener, never to a configured upstream.
   */
  constructor(
    private readonly base: URL,
    private readonly timeoutMs = 5000,
    private readonly internal?: { name: string; value: string },
  ) {}

  get(id: string, results = false) {
    return results
      ? this.#read({ kind: "results", id })
      : this.#read({ kind: "poll", id });
  }

  publicVotes(id: string, cursor?: string) {
    return this.#read(
      cursor === undefined
        ? { kind: "publicVotes", id }
        : { kind: "publicVotes", id, cursor },
    ) as Promise<z.infer<typeof publicVotesSchema>>;
  }

  async #read(read: Read) {
    try {
      const path =
        read.kind === "poll"
          ? `/api/polls/${read.id}`
          : read.kind === "results"
            ? `/api/polls/${read.id}/results`
            : `/api/polls/${read.id}/public-votes`;
      const url = new URL(path, this.base);
      if (read.kind === "publicVotes" && read.cursor !== undefined)
        url.searchParams.set("cursor", read.cursor);
      const headers: Record<string, string> = { accept: "application/json" };
      if (read.kind === "publicVotes" && this.internal)
        headers[this.internal.name] = this.internal.value;
      const response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(this.timeoutMs),
        headers,
      });
      if (response.status === 404) {
        await response.body?.cancel();
        throw new ReadError("not_found");
      }
      if (response.status === 429) {
        await response.body?.cancel();
        throw new ReadError("too_many_requests");
      }
      if (read.kind === "publicVotes" && response.status === 409) {
        await response.body?.cancel();
        throw new ReadError("anonymous_poll");
      }
      if (read.kind === "publicVotes" && response.status === 400) {
        await response.body?.cancel();
        throw new ReadError("invalid_cursor");
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
      if (read.kind === "publicVotes") {
        const page = publicVotesSchema.safeParse(raw);
        if (!page.success) throw new ReadError("upstream_invalid_response");
        return page.data;
      }
      const parsed = (
        read.kind === "results" ? resultsSchema : pollSchema
      ).safeParse(raw);
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
      if (("id" in body ? body.id : body.pollId) !== read.id)
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
