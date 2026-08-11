import type {
  Ballot,
  CastOutcome,
  Me,
  Poll,
  PulseApi,
  RequestLinkResult,
  Results,
} from "./types.js";

/**
 * Talks to the pulse API over the same origin, so the session cookie travels
 * without CORS or SameSite special-casing. In dev, vite proxies /api to the
 * server (see vite.config.ts).
 */
export class HttpPulseApi implements PulseApi {
  readonly #base: string;

  constructor(base = "/api") {
    this.#base = base.replace(/\/$/, "");
  }

  async requestLink(
    email: string,
    wantsUpdates: boolean,
  ): Promise<RequestLinkResult> {
    return this.#send("POST", "/claims", { email, wantsUpdates });
  }

  async redeem(token: string): Promise<Me> {
    return this.#send("POST", "/claims/redeem", { token });
  }

  async me(): Promise<Me | null> {
    try {
      return await this.#send<Me>("GET", "/me");
    } catch (err) {
      // Not signed in is an ordinary answer here, not a failure to report.
      if (err instanceof ApiError && err.status === 401) return null;
      throw err;
    }
  }

  async poll(pollId: string): Promise<Poll> {
    return this.#send("GET", `/polls/${encodeURIComponent(pollId)}`);
  }

  async myBallot(pollId: string): Promise<Ballot | null> {
    const body = await this.#send<{ ballot: Ballot | null }>(
      "GET",
      `/polls/${encodeURIComponent(pollId)}/ballot`,
    );
    return body.ballot;
  }

  async results(pollId: string): Promise<Results> {
    return this.#send("GET", `/polls/${encodeURIComponent(pollId)}/results`);
  }

  async cast(pollId: string, ballot: Ballot): Promise<CastOutcome> {
    return this.#send("POST", `/polls/${encodeURIComponent(pollId)}/votes`, {
      ballot,
    });
  }

  async #send<T>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(this.#base + path, {
        method,
        credentials: "same-origin",
        ...(body === undefined
          ? {}
          : {
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            }),
      });
    } catch {
      // A dropped connection would otherwise reach callers as a bare TypeError,
      // forcing every one of them to handle two error shapes. Status 0 means
      // "the request never got an answer".
      throw new ApiError(
        0,
        "Couldn't reach pulse. Check your connection and try again.",
      );
    }

    const text = await response.text();
    const parsed: unknown = text === "" ? null : safeJson(text);

    if (!response.ok) {
      throw new ApiError(
        response.status,
        messageFrom(parsed) ?? `Request failed (${response.status})`,
      );
    }
    // A 2xx carrying something that isn't JSON — a proxy's HTML error page, say —
    // would otherwise resolve as null and fail much later, inside a screen, as a
    // property access on nothing. Fail here, where the cause is still visible.
    if (text !== "" && parsed === null) {
      throw new ApiError(
        response.status,
        "pulse sent a response the app couldn't read.",
      );
    }
    return parsed as T;
  }
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Server errors carry a plain sentence in `message`; show that, never the status. */
function messageFrom(parsed: unknown): string | undefined {
  if (parsed && typeof parsed === "object" && "message" in parsed) {
    const message = (parsed as { message: unknown }).message;
    if (typeof message === "string" && message.trim() !== "") return message;
  }
  return undefined;
}
