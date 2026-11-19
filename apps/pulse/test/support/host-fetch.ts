import { request } from "node:http";
import { Readable } from "node:stream";

/**
 * A fetch for MCP test clients that sends a chosen `Host`, as a proxy in
 * front of the API forwards the public one. The platform fetch forbids
 * setting `Host`; the MCP route accepts only the configured origin's.
 */
export function fetchWithHost(host: string): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const headers = new Headers(init?.headers);
    headers.set("host", host);
    const body =
      init?.body === undefined || init.body === null
        ? undefined
        : Buffer.from(await new Response(init.body).arrayBuffer());
    return new Promise<Response>((resolve, reject) => {
      const outgoing = request(
        url,
        {
          method: init?.method ?? "GET",
          headers: Object.fromEntries(headers),
          signal: init?.signal ?? undefined,
        },
        (incoming) => {
          const responseHeaders = new Headers();
          for (const [name, value] of Object.entries(incoming.headers)) {
            if (value === undefined) continue;
            for (const each of Array.isArray(value) ? value : [value])
              responseHeaders.append(name, each);
          }
          const status = incoming.statusCode ?? 500;
          const empty = status === 204 || status === 304;
          if (empty) incoming.resume();
          resolve(
            new Response(
              empty
                ? null
                : (Readable.toWeb(incoming) as ReadableStream<Uint8Array>),
              { status, headers: responseHeaders },
            ),
          );
        },
      );
      outgoing.on("error", reject);
      outgoing.end(body);
    });
  };
}
