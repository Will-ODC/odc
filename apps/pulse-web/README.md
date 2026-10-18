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

`/trust` is "Why you can trust your vote" (#351, ADR-0039): static,
plain-language copy in four parts (Today, The basics, The plan, How to help).
It needs no sign-in and makes no API calls. Once a vote is counted, the vote
card links to it in a new tab, so the conversation's local history survives.
It must never say or imply that pulse votes are on a hash chain or ledger
before they are; today they are not. Update its plan steps as the ledger work
moves.

`/` is the static welcome page (#341): a short concept explanation, three
numbered steps and Start voting. That button opens `/start`, a one-screen
dated progress snapshot and ODC purpose explanation; its CTA opens `/questions`.
The four foundational questions are independently accessible, not conditional
Next edges. All three introductory screens make no API requests and have no video
placeholder or working-comments claim. Video and comments are separate work.
At standard text size the complete welcome fits one screen on phone and desktop;
scrolling remains available for zoom, larger text and unusually short windows.
The intro uses a centred heading, reading column and primary action. Numbered
steps share the conversation card surfaces: three columns on desktop and compact
rows on phones. All existing intro copy and routes are retained.

For a container build, pass `--build-arg VITE_PULSE_FIRST_POLL_ID=<published-id>`.
That configures the design question; `VITE_PULSE_DATA_POLL_ID`,
`VITE_PULSE_FUNDING_POLL_ID` and `VITE_PULSE_REVOTE_POLL_ID` configure the other
three. The same names are Docker build arguments. Unset/blank IDs leave the
corresponding question disabled and marked Coming soon; no demo fallback.
This value is public client configuration, not a credential. Changing it requires
a rebuild. `/conversation` without a poll keeps the existing development start;
sign-in redemption still returns there through an explicit poll link. Starting
from the welcome adds a history entry so Back returns to the introduction.
The progress snapshot is editorial static content with a fixed date range and
links to merged work. Updating it needs a content change; it is not a live
weekly feed or a claim that merged code has been deployed. Data control, optional
verification and pooled democratic resources are explicitly ODC goals; this
does not change Pulse identity, ballot or data-use policies.

`/?poll=ID` is a direct live conversation vote link
(#301/#302). Existing `/conversation` and `/conversation?poll=ID` links remain supported, using the public Pulse API. Desktop has an Answered sidebar; phone and
desktop offer a small Vote tab. It expands above the disabled assistant
composer on phone and at the top right below the banner on desktop (operator
layout experiment). Desktop positioning follows the banner’s actual height,
including the extra guest-vote cleanup control; cards keep the phone’s viewport
height cap and scroll internally.
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

Optional **Show me how** (#342) on an open question adds one small help callout
and a visual spotlight around the real Vote, choices, Submit and results
controls. It follows the current card state, including sending, failure/retry,
closure and saved answers. Help never picks or submits. Skip/Done or Escape
removes it and restores focus to Show me how; replay retains current choices.
The guide is nonmodal: normal controls and keyboard navigation remain available.
It adds no tracking or persistent completion state, and uses no animation.
Loading, missing and initially closed questions do not offer coaching. Next is
explained only when a real answer-dependent destination exists; the foundation
question list remains independent. No API or permissions change.

Banner-spacing regression check: at 1440×900, compare the banner’s bottom edge
with the top of both Vote and Show me how, before voting and after a guest vote
adds Forget my votes here. Both controls must clear the banner by at least 8px.
Also check the expanded card and 375×667 phone layout.
