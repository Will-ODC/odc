# `services/web` UI rules (charter-side)

These rules belong to `services/web`, the charter-governed human client (Phase
2, not started). They do not apply to `apps/pulse-web`; `SKILL.md` in this
folder covers everything both clients share.

## Plain-language dictionary

| Never show                     | Show instead                 |
| ------------------------------ | ---------------------------- |
| keypair, public key, signature | "your account" / "signed in" |
| event, event log, append       | "the public record"          |
| hash chain, hash, NDJSON       | "tamper-proof record"        |
| participant_id, pseudonym      | "your voting name"           |
| tally derivation               | "results"                    |
| verify the export              | "check the record yourself"  |

Keys are generated, stored and used invisibly: "Sign up" creates a keypair,
"Vote" authenticates with it, and the user is told neither unless they open an
"Advanced" section, where export-your-key lives for the curious. The ballot
itself is signed by the registrar, never by the voter's key (ADR-0004;
`services/ledger/CLAUDE.md`).

## Trust affordances (product requirements, not decoration)

- Results pages always link "check the record yourself" → export download,
  plus a one-paragraph plain explanation of what the verifier proves.
- Anything monetizable (future sentiment instruments) is visually
  unmistakable from governance, with the consent sentence at the point of
  action — per the charter, never buried in settings.

## Hub feed rules (post-MVP — do not build a feed before it is planned)

- Three lanes, unmistakable at a glance: Opinion (quiet neutral chip), Ballot
  (accent border — the only emphasized card class), Action (success-tinted
  chip). One-tap interaction exists ONLY on opinion cards.
- **Binding actions never execute from feed context.** Ballot and action cards
  are navigational doors only ("Read briefing and vote", "View on board");
  voting and claiming happen on their own pages, with confirmation, in slow
  mode.
- Ballots are surfaced deterministically (pinned open-ballots bar, deadline
  reminders), never left to feed ranking. Sentiment-lane sort orders are
  user-selectable and transparent; no engagement-optimized default.
- Opinion cards state their nature in fine print: reactions are opinion, not a
  vote.
