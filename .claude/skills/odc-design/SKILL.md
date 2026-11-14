---
name: odc-design
description: The ODC design of record — which mockup deck is the reference for which surface, how to author or edit a mockup in docs/mockups, what a mockup may and may not depict, how to show one locally, and how to publish a design as an Artifact for review. Use this skill whenever designing a screen, creating or editing a mockup, choosing a visual direction or palette, asking "what should this look like", or publishing a design deck for the operator to look at. For writing the actual UI code, use odc-ui.
---

# ODC Design of Record

Designs live as hand-authored HTML in `docs/mockups/`. They are the reference
the code is built against; they are **not** the app and their markup is never
copied into a client. `odc-ui` builds the code; this skill decides what it is
supposed to look like, and where that decision is written down.

## What is reference, and what is not

[`docs/mockups/CANDIDATE_CONTEXT.md`](../../../docs/mockups/CANDIDATE_CONTEXT.md)
is the canonical index of current references, retained alternatives and
historical decks, for Pulse and the charter-side ODC candidates. Read it before
choosing a deck, and update it in the same change that moves a candidate's
standing; do not duplicate its status table here.

Palette and tokens: read the values from
`docs/mockups/pulse-screens/_screens.css` (the canonical `:root` block), never
from memory. The app's own tokens are `apps/pulse-web/src/styles/tokens.css`
(`odc-ui`). The archive's mixed palettes (including the retired dark swipe
ballot in `01-claim.html`) do not reopen the current conversation design; the
current card uses explicit selection and Submit (ADR-0035).

## Authoring a mockup

- One screen per file, standalone and openable directly. Shared tokens and
  styles live in `_screens.css`; edit a token there and every screen moves.
- `_nav.js` keeps the flow walkable across files; `index.html` is the gallery.
- A screen that deliberately breaks the shared palette carries its own chrome
  in its own file (the `01-claim.html` precedent) and says why in a comment.
- Mockups are exempt from prettier and the diff-size ceiling, **but the
  pre-commit hook still lints `.js`** — a script in this directory needs
  `/* global document, location */`, since flat config ignores `eslint-env`.
- Fake data is fine and expected ("1,240 verified humans"), but it must be
  obviously fake. Never put a real person, a real email, or real participant
  data in a mockup.

## What a mockup may depict

The mockups run ahead of the build on purpose, but not past these lines:

- **Charter-side MVP: no free-text content in the event log.** The hub-feed
  decks' threaded discussion is forward-looking illustration, not a claim about
  what ships in Phase 0/1. Pulse is charter-exempt; its comments are separate
  planned work (#297), not a shipped surface.
- **Pulse may explain counting, and never claims more than is built**
  (ADR-0039). The explanation lives at `/trust`, in plain language with each
  technical term explained where it first appears. No mockup may imply Pulse
  votes are on a hash chain or ledger before they are.
- **Charter-side keeps the taxonomy**: Ballots / Opinions / Actions, "Online
  Democratic Community", "verified humans". Ballot and Opinion are never drawn
  so they could be mistaken for each other.
- A design that requires a charter change is a stop-and-flag, not a mockup.

## Publishing a design as an Artifact

For review, a walk-through, or anything the operator will look at rather than
open locally, publish it as an Artifact.

- Load the `artifact-design` skill first — it governs the design pass; this
  skill only says what content is allowed.
- Self-contained: inline the CSS and any script, embed assets. Google Fonts is
  the one external host that loads, which is how Inter gets in.
- Theme-aware unless the design deliberately commits to one look, in which
  case say so rather than half-adapting.
- Fake data only, per above, and label it as illustrative on the page.
- A published Artifact is a view of the deck, never the deck itself; the design
  of record stays in `docs/mockups/`.

## Showing work locally

Open a mockup in the browser pane with `preview_start` and a `url`, or serve
the deck from the repo or worktree root and hand the operator the URL:

```
python3 -m http.server 8123 --bind 127.0.0.1
# then http://127.0.0.1:8123/docs/mockups/pulse-screens/
```

Iterate **one screen at a time** with feedback between screens — that is the
agreed working shape, not a big-bang deck drop.

## Before you call a design done

- [ ] The deck is openable standalone and walkable via `_nav.js`.
- [ ] Tokens changed in `_screens.css`, not inline in a screen.
- [ ] Palette matches a decided direction, or the decision is now recorded.
- [ ] The vote's six scenarios remain covered per the canonical index, using
      current behavior; every view owes loading / empty / error / content
      per `odc-ui`.
- [ ] No claim of free-text content in the charter-side MVP event log; no
      claim that Pulse votes are on a chain or ledger before they are
      (ADR-0039); no real data.
- [ ] `CANDIDATE_CONTEXT.md` updated if a candidate's standing moved.
