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

`/` is the static welcome page (#341): a short concept explanation, three
numbered steps and Start voting. Set `VITE_PULSE_FIRST_POLL_ID` at client build
time to the reviewed, published first poll. Without it the button is disabled
and the page explains that the first vote is being prepared; it never falls
back to a demo question. The landing makes no API requests and has no video
placeholder or working-comments claim. Video and comments are separate work.
At standard text size the complete welcome fits one screen on phone and desktop;
scrolling remains available for zoom, larger text and unusually short windows.

For a container build, pass `--build-arg VITE_PULSE_FIRST_POLL_ID=<published-id>`.
This value is public client configuration, not a credential. Changing it requires
a rebuild. `/conversation` without a poll keeps the existing development start;
sign-in redemption still returns there through an explicit poll link. Starting
from the welcome adds a history entry so Back returns to the introduction.

`/?poll=ID` is a direct live conversation vote link
(#301/#302). Existing `/conversation` and `/conversation?poll=ID` links remain supported, using the public Pulse API. Desktop has an Answered sidebar; phone and
desktop offer a small Vote tab. It expands above the disabled assistant
composer on phone and at the top right on desktop (operator layout experiment).
The top-right × closes decision and result cards and returns to the small tab;
its accessible name remains Close. Select then
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
