import type { FastifyInstance } from "fastify";
import type { ConsoleMailer, SentMessage } from "./identity/mailer.js";

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
const LOOPBACK_PEERS = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];

/** Development entry point only: captured mail, never a substitute login. */
export function registerDevMailbox(
  app: FastifyInstance,
  mailer: ConsoleMailer,
  webOrigin: string,
): void {
  const origin = new URL(webOrigin);
  app.get("/api/dev/mailbox", async (request, reply) => {
    reply
      .header("cache-control", "no-store")
      .header("referrer-policy", "no-referrer")
      .header("x-frame-options", "DENY")
      .header("cross-origin-resource-policy", "same-origin")
      .header(
        "content-security-policy",
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      );
    const site = request.headers["sec-fetch-site"];
    if (
      !LOOPBACK_HOSTS.includes(origin.hostname) ||
      !LOOPBACK_PEERS.includes(request.raw.socket.remoteAddress ?? "") ||
      request.headers.host !== origin.host ||
      (request.headers.origin !== undefined &&
        request.headers.origin !== webOrigin) ||
      (site !== undefined && site !== "same-origin" && site !== "none")
    ) {
      return reply.code(403).send({
        error: "local_only",
        message: "Open the mailbox from the local app.",
      });
    }
    const messages = [...mailer.sent].reverse();
    return reply.type("text/html; charset=utf-8").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Local mailbox · Pulse</title></head>
<body><main><h1>Local mailbox</h1>
<p>Development only. These messages stay on your computer; no email was sent.</p>
<p><a href="/api/dev/mailbox">Refresh inbox</a></p>
${messages.length === 0 ? "<p>No messages yet. Request a sign-in link in the app, then refresh this inbox.</p>" : messages.map((message) => renderMessage(message, webOrigin)).join("\n")}
</main></body></html>`);
  });
}

function renderMessage(message: SentMessage, webOrigin: string): string {
  let content = `<pre>${escapeHtml(message.body)}</pre>`;
  if (message.kind === "claim-link") {
    try {
      const link = new URL(message.body);
      if (link.origin === webOrigin && link.pathname === "/sign-in") {
        content = `<p><a href="${escapeHtml(link.href)}">Open sign-in link for ${escapeHtml(message.to)}</a></p>`;
      }
    } catch {
      // Unexpected captured content is text, never an executable URL.
    }
  }
  return `<article><h2>${escapeHtml(message.subject ?? "Sign in to Pulse")}</h2><p>To: ${escapeHtml(message.to)}</p>${content}</article>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const escaped: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return escaped[character] ?? character;
  });
}
