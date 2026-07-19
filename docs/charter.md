# Online Democratic Community — Charter

_A whitepaper. This document is the argument and the architecture; implementation details live in component specs._

---

## 1. Purpose

Public infrastructure for collective decision-making: a permanent, verifiable record of deliberation, votes, and action — open to any person, community, or AI agent to read, join, and build on.

Not an app. Apps are clients of it.

## 2. The problem

Online collective decision-making fails in three recurring ways. Records can be quietly altered, so results require trusting an operator. Participation is either anonymous and gameable or identified and coercible. And votes rarely lead to anything, which teaches people that voting is theater.

This project's response is three bets:

1. **Trust comes from verifiability, not authority.** Anyone with a copy of the record can prove it hasn't been tampered with.
2. **AI belongs on the citizen's side.** AI helps people participate; it never sits above the votes interpreting what they "really mean."
3. **Votes lead to action.** Decisions produce funded, executed, proven outcomes — and the people who execute them build trust by doing so.

## 3. Four root principles

Everything else in this document is a consequence of these.

**P1. The log is the only truth; everything else is a derived view.**
All activity — votes, arguments, positions, trust grants, disbursements, proofs, delegations, even moderation — is an event in a single append-only, hash-chained log. Tallies, reputations, and delegation graphs are computations over the log, never separately stored authorities. Anything computable by the platform is recomputable by anyone else.

**P2. One verified human, two planes.**
A single personhood credential ("real, unique human") backs two identities that the system guarantees are the same person but cannot link:

- the **ballot plane** — anonymous, unlinkable, strictly equal;
- the **public plane** — persistent, named, reputation-bearing.
  Secrecy where power could coerce; accountability where money and advocacy live.

**P3. The platform characterizes; it never weighs.**
It records who said what with what attestations, and publishes many views in parallel. It never selects a winning aggregation method, weights a ballot, gates a community, or ranks an expert. Interpretation belongs to readers; legitimacy belongs to the community and whatever rule it chooses for itself.

**P4. Floors, not ladders.**
Requirements to participate must be achievable by anyone, for free (personhood; an accessible issue briefing). Nothing creates a class of superior voters. Trust ladders exist only for execution capacity — what you may be entrusted to _do_, never how much your vote counts.

## 4. The record

- **Append-only event log** with per-event hash chaining, computed at insert time. Insert-only permissions enforced at the storage layer. The construction is a **transparency log** (the Certificate Transparency lineage) — deliberately not a blockchain: one writer, many verifiers, no consensus needed. A Merkle tree over the same events (RFC 6962 conventions, enabling per-event inclusion proofs) is a planned additive upgrade when scale warrants; it derives from the log and can be retrofitted at any time.
- **The export format is the canonical artifact**: hash-chained newline-delimited JSON, with a one-page spec precise enough that a stranger can write an independent verifier in an afternoon. The storage engine (currently Postgres, chosen for multi-service access and enforceable append-only grants) is a swappable implementation detail; no meaning may depend on it.
- **Non-equivocation by anchoring.** The chain head is periodically published where the operator cannot rewrite it — public repos in v1, anchored to an existing public blockchain in v2. This buys the one property blockchains genuinely offer, without running one: the log itself needs no consensus, because it has one writer and many verifiers.

## 5. The ballot plane

- **Secret, equal, unlinkable — always.** The canonical tally is one verified human, one vote, and this never varies.
- **Receipt-free by design.** No one can prove how they voted, even voluntarily. A disclosure option that exists can be demanded; only impossible proof protects the coercible. Public advocacy is served by the public plane instead (§6).
- **Parallel tallies, not weights.** Ballots may carry anonymous attributes (verified human; completed the issue briefing; holds a domain attestation). Results publish side by side — all voters, briefing-completers, attested experts — and the gaps between them are public information. No tally is declared the winner; expertise becomes _legible_ rather than _imposed_.
- **The briefing credential.** Each issue ships a free, short, accessible briefing presenting the steelman of each position. Completing it attaches a credential to your ballot and feeds a parallel tally. Briefing content is itself contestable through the platform's deliberation — whoever writes the curriculum must not control the electorate.
- **Multiple aggregation methods in parallel** (approval, ranked-choice/STV, quadratic, others) computed from the same ballots. Choosing among them is a downstream act.

## 6. The public plane

- **Position statements.** A named participant may publish a signed, on-the-record position — "I endorse plan Y" — as a first-class, reputation-bearing event. This delivers everything advocacy needs while proving nothing about any ballot.
- **Communities as participants, characterized not gated.** Organizations submit collective positions through the same participant abstraction, with an attestation profile: what kind of body, how many members, how the position was reached. Institutional positions display **alongside** individual tallies, never summed into them — member counts are self-attested claims for readers (and third-party analyses) to weigh, not vote weights.
- **Delegation is public, opt-in, and never canonical.** Liquid-democracy delegation is inherently an open-ballot mechanism, so it lives here: explicit, revocable, topic-scoped delegation events on the public identity, feeding a delegated parallel tally or governing a community that chooses that rule internally. The anonymous equal count always publishes regardless. (Delegating to an AI agent is the same primitive with a different delegate, under the same explicit-and-revocable discipline.)
- **Votes and sentiment stay separate primitives.** Ballots are formal; endorsements and engagement are observational. They are never conflated.

## 7. Trust, money, and action

- **Reputation is a derived view over public-plane events** — trust grants, vouches, disbursements, proofs, verified completions, failures — computed from the log like any tally. A default view is shown; anyone may compute their own.
- **Trust gates execution capacity, never decision weight.** Standing raises a spending ceiling; it never touches a ballot.
- **The ladder:** personhood is the floor; small proven executions raise the ceiling sublinearly and rate-limited in time (so trust cannot be farmed cheaply or speedrun toward one large defection). Failure and fraud crater it.
- **Vouching costs the voucher.** A trusted person may stake their own standing on a newcomer; the vouch pays off or bleeds with the newcomer's conduct. Attesting personhood and vouching trustworthiness are edges in the same recorded attestation graph — humans verifying humans, the system's trust root (in-person verification being its strongest form).
- **Two-stage initiatives close the loop:** the community approves the idea; the initiator submits a concrete plan the same voters approve; execution requires published proof, community-verifiable, before closing. Legitimacy without exclusion: a low floor to participate, graduated ceilings to disburse.

## 8. Data belongs to its origin

Participation generates data, and today the value of such data is harvested by platforms. Here it belongs to the people it comes from.

- **Ballots are outside commerce, by construction and forever.** Anonymized votes are never monetized, individually or collectively — this is guaranteed structurally, not by policy: receipt-freeness means no sellable artifact of an individual vote can exist, and the canonical governance tally is never a product. Voters who choose full anonymity owe nothing to any data market, ever. This is non-negotiable and survives any future community vote.
- **Monetizable data is a separate, labeled stream.** Only clearly-marked opt-in instruments (sentiment polls, research questions, attribute surveys) can be licensed — an application of the existing votes-vs-sentiment separation. Governance behavior is never for sale, so it is never distorted by being watched.
- **Individual sovereignty over the public plane.** Each participant owns, can export, and controls the licensing of their own public-plane data (positions, executions, arguments, attributes).
- **Collective licensing is a governed act.** Whether, to whom, and on what terms community data is licensed is itself a community vote; consent grants and revocations are logged, revocable events; revenue flows to the community treasury as tracked disbursements, funding initiatives. Ethics and transparency become checkable properties of the record, not promises.
- **What makes the data valuable is the personhood floor:** attested, unique, k-anonymized humans — the signal an AI-saturated data economy cannot fake. Monetized instruments therefore sit behind the strongest personhood tier, and k-anonymity floors on any released aggregate are load-bearing, since buyers are motivated to de-aggregate.
- **Legal structure (cooperative association, tax, securities) before any revenue flows** — deferred, with counsel, not skipped.
- **Custody roadmap.** v1 protects the sentiment store by policy: minimization, encryption at rest, open books (all revenue mappable to licensed chain events; unexplained data in the wild is thereby provably stolen), and canary entries that make leaks attributable. v2 protects it by structure: **threshold custody** — the store's key split k-of-n among few, independent, community-elected custodians (privacy institutions preferred over crowds), with decryption **gated by the chain itself**: custodian tooling contributes shares only against a valid recorded license vote, and every decryption is logged. Same trajectory as identity: trust-by-policy first, then math plus distributed humans.
- **Exit is a right.** Members individually: revoke consent, withdraw from future licenses, leave with their keys and public-plane history. Collectively: the community can fork — the export, the software, the rules, and keys-as-identity mean a community can re-declare genesis anchored to the old chain's head and continue elsewhere without anyone's permission. Credible exit disciplines the operator even if never used; it remedies the future, not the past — which is why custody hardening precedes any data worth stealing.

## 9. Openness

- **Protocol as commons.** The MCP server is the canonical interface; the web app, mobile clients, civic tools, and citizens' own AI agents are peers among its clients. Anyone may build a front-end, including ones we dislike. The loss of UX control is accepted deliberately.
- **Resources for reads, tools for mutations** — an enumerable, auditable surface. Reasoning aids (e.g. "steelman the opposing view") ship as prompts, giving every citizen the same analytical scaffolding regardless of their model.
- **Transparency by default.** Moderation actions are themselves public events. No hidden authority.

## 10. Components, in dependency order

1. **Event log** — the spine; hashing rules fixed before the first real event.
2. **Export + verifier** — the format spec, exporter, and standalone CLI verifier; first milestone, alongside the log.
3. **Tally engine** — all derived views: aggregations, parallel tallies, reputation, delegation graphs.
4. **Minimal API** — enough to develop against.
5. **Web app** — human-facing client (the existing onlinedemocracy.org is the seed).
6. **Identity service** — v1: key-based pseudonyms, linkage held privately, physically separated from the log; v2: blind-signature credentials and in-person enrollment.
7. **MCP server** — thin wrapper over the substrate; built last because everything below it must already be trustworthy.

## 11. Out of scope for v1

Deferred, not rejected: full cryptographic vote integrity (ZK proofs, homomorphic tallying, mix-nets); the complete credential and enrollment system; coercion-resistance beyond receipt-free design; moderation tiers; multi-tenancy. Build the substrate, seed a real community, and let these designs answer observed needs.

## 12. Guiding principle

Make the record trustworthy and the deliberation legible — then get out of the way. Equality is guaranteed in secret; trust is earned in public; interpretation stays plural; and the AI is a participation aid, never an oracle.
