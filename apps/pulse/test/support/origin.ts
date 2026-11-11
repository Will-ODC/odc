import type { FastifyInstance, InjectOptions } from "fastify";

/**
 * Make `app.inject` send `Origin` on every non-GET request, the way a browser
 * page on `origin` does: browsers send it on every POST, same-origin included.
 *
 * Sign-in, redemption, sign-out and creation mutations refuse a missing or
 * foreign `Origin`, so a harness that drives them as the pulse-web client
 * would needs this. A request that names its own `origin` header keeps it; one
 * that sets `origin: undefined` is sent with no `Origin` at all, which is how a
 * test pins the refusal of a missing one.
 */
export function sendOriginLikeABrowser<T extends FastifyInstance>(
  app: T,
  origin: string,
): T {
  const inject = app.inject.bind(app) as (
    options: InjectOptions | string,
  ) => ReturnType<FastifyInstance["inject"]>;
  const wrapped = (options: InjectOptions | string) => {
    if (typeof options === "string") return inject(options);
    const method = (options.method ?? "GET").toUpperCase();
    const headers = { ...(options.headers ?? {}) } as Record<string, unknown>;
    if ("origin" in headers) {
      if (headers.origin === undefined) delete headers.origin;
    } else if (method !== "GET" && method !== "HEAD") {
      headers.origin = origin;
    }
    return inject({ ...options, headers } as InjectOptions);
  };
  (app as unknown as { inject: unknown }).inject = wrapped;
  return app;
}
