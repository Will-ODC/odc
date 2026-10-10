# Pulse web

The Vite client serves the story and sign-in screens. In development, `pnpm
--filter @odc/pulse-web dev` proxies `/api` to the Pulse server on port 8080.
The production Docker image serves the built page through nginx on port 8080
and forwards `/api` to the `api` container, keeping page and API on one origin.

Emailed sign-in links open `/sign-in?token=…`. The page sets `no-referrer` before
loading any assets, because asset requests can otherwise send the token URL as
their `Referer` before React redeems it. Nginx omits both request query strings
and incoming `Referer` values from its access log. Keep both protections when
changing the page head or access log format.

`/preview/chat` is a prototype (#228): a sample conversation with one decision
answered in a popup, and a "Preview state" control that shows the eligible,
not-yet-confirmed, closed and send-fails states. It uses sample data only and
makes no API calls; live voting in a conversation comes later. The decision
itself (`src/flow/decision.ts`) carries no presentation, so the same question
can be drawn by another interface.
