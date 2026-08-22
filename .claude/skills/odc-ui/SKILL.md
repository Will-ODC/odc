---
name: odc-ui
description: UI conventions and plain-language rules for every ODC user-facing surface — the pulse story client (apps/pulse-web), the charter-governed web client (services/web), and the HTML mockups in docs/mockups. Use this skill whenever building or modifying any page, screen, component, form, or user-visible string — including error messages, empty states, and button labels — even for small tweaks.
---

# ODC UI Conventions

Audience: an average citizen, not a developer. The implementation plan
demands that complexity stays inside while the API speaks plain nouns and
verbs; the UI is where that promise is kept or broken.

## Scope — two clients, one set of manners

| Surface          | What it is                                      | Status                                 |
| ---------------- | ----------------------------------------------- | -------------------------------------- |
| `apps/pulse-web` | Pulse's one-screen story client, charter-EXEMPT | **Live** — where UI work happens today |
| `services/web`   | The charter-governed human client               | Phase 2, not started                   |
| `docs/mockups/`  | Hand-authored HTML design decks                 | The design of record                   |

Everything in this skill applies to both clients **except** the plain-language
dictionary and the trust affordances, which are charter-side and belong to
`services/web`. **Pulse goes further, not less far:** its rule is that the
counting is never the subject at all, so it does not translate "hash chain"
into "tamper-proof record" — it never raises the topic. Do not port the trust
affordances or the "check the record yourself" link into pulse; there is no
verifier there and saying so would be a lie. See `apps/pulse/CLAUDE.md`.

Pulse's visual language is translucent **"Civic Glass"** —
`docs/mockups/pulse-screens/` and `pulse-story-mobile-v1.html` are the
reference. **`hub-feed-v*.html` is NOT.**

## Plain-language dictionary (enforced in `services/web`)

| Never show                     | Show instead                 |
| ------------------------------ | ---------------------------- |
| keypair, public key, signature | "your account" / "signed in" |
| event, event log, append       | "the public record"          |
| hash chain, hash, NDJSON       | "tamper-proof record"        |
| participant_id, pseudonym      | "your voting name"           |
| tally derivation               | "results"                    |
| verify the export              | "check the record yourself"  |

Keys are generated, stored, and used invisibly. "Sign up" creates a
keypair; "Vote" signs an event; the user is told neither unless they open
an "Advanced" section, where export-your-key lives for the curious.

## Every view has four states — no exceptions

loading · empty (with a next step, never a blank) · error (what happened,
in one plain sentence, and what to do) · content.
A component PR without all four is incomplete.

## Structure & style

- Small components, one purpose each; pages compose components; logic
  lives in hooks/services, never in JSX.
- One design-token file (colors, spacing, type scale); no hardcoded hex
  or magic pixel values in components.
- Forms: label every field, validate inline on blur, error text beside the
  field, disable submit while pending, always confirm destructive or
  binding actions ("You're voting YES on… — confirm?").
- Accessibility floor: semantic HTML first, visible focus states, 4.5:1
  contrast, alt text, full keyboard operability. Test with keyboard only
  before merging any interactive component.

## Hub feed rules (post-MVP — do not build a feed before it is planned; MVP pages have none)

- Three lanes, unmistakable at a glance: Opinion (quiet neutral chip),
  Ballot (accent border — the only emphasized card class), Action
  (success-tinted chip). One-tap interaction exists ONLY on opinion cards.
- **Binding actions never execute from feed context.** Ballot and action
  cards are navigational doors only ("Read briefing and vote", "View on
  board") — voting and claiming happen on their own pages, with
  confirmation, in slow mode.
- Ballots are surfaced deterministically (pinned open-ballots bar,
  deadline reminders), never left to feed ranking. Sort orders for the
  sentiment lane are user-selectable and transparent; no engagement-
  optimized default.
- Opinion cards state their nature in fine print: reactions are opinion,
  not a vote.

## Trust affordances (product requirements, not decoration)

- Results pages always link "check the record yourself" → export download
  - one-paragraph plain explanation of what the verifier proves.
- Anything monetizable (future sentiment instruments) is visually
  unmistakable from governance, with the consent sentence at the point of
  action — per the charter, never buried in settings.
