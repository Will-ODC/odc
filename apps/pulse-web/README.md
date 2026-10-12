# Pulse web

The Vite client serves the conversation voting and sign-in screens. In development, `pnpm
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
makes no API calls; the default conversation page uses the live API. The decision
itself (`src/flow/decision.ts`) carries no presentation, so the same question
can be drawn by another interface.

`/` (or `/?poll=ID`) is the default live conversation vote page
(#301/#302). Existing `/conversation` and `/conversation?poll=ID` links remain supported, using the public Pulse API. Desktop has an Answered sidebar; phone and
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
comments or generated messages are shown. Redeeming a sign-in link lands on
the first conversation question, replacing the spent-token URL in history.
The swipe and old run screens are retired; `/preview/chat` remains sample data only.
The old choice screen's suggestion form and next-question preview rail are also
retired; poll suggestions remain supported by the public API, without a form
on this conversation page.
