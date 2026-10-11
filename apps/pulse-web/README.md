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

`/conversation` (or `/conversation?poll=ID`) is the live conversation vote page
(#301), using the public Pulse API. Desktop has an Answered sidebar; phone and
desktop offer a small Vote tab. It expands above the disabled assistant
composer on phone and at the top right on desktop (operator layout experiment).
Close returns to the small tab. Select then
Submit; results appear in the card, with Change my answer, Close, and Next
where the selected answer opens another question. Approval votes submit every
selection; equal-value navigation uses the lowest choice index (ADR-0021).
Answered questions remain in the conversation and can be revisited. This history
is local to the open page and resets on reload; votes remain on the server.
Closed questions offer public results and cannot cast or change answers.

The assistant is unavailable and typing is disabled. No placeholder photos,
comments or generated messages are shown. `/` and the sign-in landing remain the
existing ballot run until #302; `/preview/chat` remains sample data only.
