# ADR-0008: What the fixture freeze protects — four rules, not one

- **Status:** accepted
- **Date:** 2026-08-02
- **Phase:** 0

## Context

`contracts-guard.sh` enforces, once the `contracts-v1` tag exists, that nothing
under `contracts/fixtures/` may be modified — only added. The intent is
`odc-testing`'s rule that golden values never regenerate: a failing test must
never be "fixed" by editing the expected answer.

**That rule makes adding a vector impossible, which `evolution.md` EV-5/EV-14
require.** Adding one vector touches four paths, and only one of them is new:

| path                  | git status                                                 |
| --------------------- | ---------------------------------------------------------- |
| `vectors/<id>.ndjson` | `A`                                                        |
| `index.json`          | `M` — the register gains an entry                          |
| `MANIFEST.sha256`     | `M` — gains a line, AND its digest of `index.json` changes |
| `fixtures/README.md`  | `M` — it states the vector count                           |

So three of four fail the guard, EV-5 becomes unsatisfiable, and **no
post-freeze event type could ever ship**.

This is the second time this deadlock has been found. PR #9 fixed the first
instance — the guard had rejected new vector _files_ — and stopped there,
missing the aggregate files one layer up. Both instances share a cause: the
rule is stated over a _directory_, while the property being protected belongs
to a _kind of file_. Only some of what lives in `fixtures/` holds golden
values.

It is invisible in CI. The entire freeze branch is gated on a tag that does not
exist, so every check is green today and will stay green until the first
post-freeze additive change — at which point the tag exists and the guard is
being edited under pressure.

`MANIFEST.sha256` cannot be fixed by an add-only rule at all: it contains a
digest **of `index.json`**, so it necessarily changes whenever the register
grows. No formatting trick avoids that.

## Decision

**Four kinds of file, four rules**, applied only once `contracts-v1` exists:

1. **`vectors/**`, `preimages/**`, `derivations.json` — additions only.**
   Unchanged. This is the real freeze.
2. **`index.json` — may gain lines, may not lose any.** Its diff MUST contain
   zero deletions. Appending an entry is a pure insertion and passes; changing
   any existing `expect`, `head`, `export` or `note` rewrites a line, which is a
   deletion plus an addition, and fails. Additionally, ids MUST be unique — a
   _pure addition_ reusing an existing id would otherwise assert two
   contradictory verdicts over the same frozen bytes.
3. **`MANIFEST.sha256` — not diff-policed; its correctness is enforced instead.**
   It may be regenerated freely but not deleted or renamed.
   `fixtures-manifest.sh` is invoked _by the guard_ whenever the tag exists.
4. **`fixtures/README.md` — exempt.** Prose that necessarily states a count,
   governed by review, the `Version:` bump check, and the changelog check.

### The line rule alone was NOT enough — the duplicate-key hole

A fresh-context review of this ADR's first implementation produced a working
exploit, and it is worth recording because it nearly shipped.

Insert a **second `"expect"` key** into an existing entry, immediately after the
first. That is a pure insertion — `git diff --numstat` reports zero deletions —
so it passes rule 2's line check, and it never touches the `"id"` line so it
passes the id-uniqueness grep. But **every JSON parser resolves a duplicate key
to the last value**, so the vector's frozen verdict silently flips. This repo's
own `tools/fixtures-gen` parses `index.json`, so those are the live semantics,
not a theoretical ambiguity. The same trick works on `export` (repointing a
frozen id at another vector's bytes) and on `head`.

So rule 2 gains a second, general clause: **no object anywhere in `index.json`
may repeat a key**, and the file must parse. This is deliberately not fixed
key-by-key — patching only `expect` would have left `export` and `head` open.

Note what this check is and is not. It is a **well-formedness assertion over one
file** — total, cheap to get right, and with no notion of "changed" at all. It
is not the semantic before/after comparator rejected below, which had to decide
which changes were legitimate and would fail open when it decided wrong. It runs
ungated on the tag, since a duplicate key is a defect whenever it appears and
the generator can never legitimately emit one.

### Why a line rule and not a JSON comparator

Rule 2 could compare parsed entries and allow advisory fields to change. It
deliberately does not. **This check is the only thing holding the freeze up**,
and a comparator with a subtle bug fails open — the freeze silently stops
protecting anything while CI stays green. That is the same failure shape as the
fixture mutators that returned canonical bytes under an `INVALID` declaration
(PR #31, and the `swapLines`/`editLine` guards). A rule with almost no logic in
it cannot fail that way.

The cost is that **note prose is frozen too**. `cites` and `note` are advisory
under EV-17, and an argument exists for keeping them correctable, since this
repo has shipped factually false notes before (vectors 057 and 070, both fixed
in PR #31). That argument was weighed and rejected: nothing false is frozen
today, and the entire release-candidate period — which ADR-0007 leaves open
indefinitely — remains editable. **Note corrections must land before the tag.**

Rule 2 also freezes `index.json`'s **formatting**, since a reformat rewrites
every line. This is safe because `.prettierignore` excludes `contracts/`
entirely, so no formatter can touch it; but it does mean the generator's output
format for that file is fixed at the tag.

### Why the manifest needs no diff rule

With rule 1 in force the bytes it digests cannot change, so every existing
vector digest is pinned transitively. The only digest that can legitimately move
is `index.json`'s, and rule 2 polices `index.json` directly. Every laundering
path we could construct is closed: editing a vector trips rule 1; doctoring a
digest trips `sha256sum -c`; deleting a manifest line makes the file unlisted;
deleting the manifest trips rule 3.

Two supporting fixes were required to make that argument true rather than
merely plausible:

- **The manifest check now runs from the guard.** It previously lived only in
  `repo.yml`, a different workflow that nothing freezes, so the freeze depended
  on a file anyone could edit. It now fails closed inside one script.
- **Non-regular files are rejected.** `find -type f` skips symlinks, so a vector
  committed as a symlink was status `A` (legal), never listed, never digested —
  golden bytes living outside `contracts/` and mutable after the freeze.

## Consequences

- EV-5/EV-14 become satisfiable after the tag; a post-freeze event type can ship
  its vectors. That was the point.
- The freeze is **stronger than before**, not weaker. Previously the guard knew
  only "this file changed" — it could not tell an honest append from a flipped
  verdict, because both were simply blocked pre-tag and neither was analysed.
  Rules 2 and 3 now catch a removed register entry whose vector file remains
  (which rule 1 never sees) and an unmanifested vector.
- **What the freeze still does not do, stated plainly:** it does not make new
  vectors _correct_. A wrong addition is caught by review, before and after the
  tag, and by nothing else. The freeze protects existing assertions only.
- The `RETIRED.md` valve (`memory/OPEN-QUESTIONS.md`) is unaffected — it remains
  an additive file. Frozen notes make it slightly more load-bearing: a vector
  later found wrong can no longer be annotated in place, so `RETIRED.md` becomes
  the only route.
- Supersedes the rationale comment PR #9 left in `contracts-guard.sh`, which
  described the intent as being about vectors rather than about golden values.
- 11 new scenarios in `guards.test.sh` (19 → 30), each mutation-verified:
  removing any rule fails at least one. Scenario 7m asserts the exploit's
  premise first — that the attack really does delete zero lines — so it proves
  the duplicate-key check is what catches it, rather than the line rule.
- **No unfalsifiable branches.** An explicit "is python3 installed" arm was
  written and then removed: no test in an environment that has python3 can make
  it fire, and a missing interpreter already exits non-zero into the same error
  path. A branch guarding a permanent freeze that no test can kill is worth less
  than no branch at all — the same lesson the `assertWholeMinute` split records.

## Charter check

- **P1 (anything computable by the platform is recomputable by anyone else).**
  Directly served. The freeze exists so an independent verifier can be graded
  against assertions that provably have not moved; the deadlock would have
  frozen the conformance set at whatever it happened to contain at tag time,
  making later event types unverifiable by anyone.
- **P2, P4.** Untouched — no participant data, no participation requirement.
- **P3 (the platform characterizes, it never weighs).** Untouched: rule 2 fixes
  what a vector _asserts_, and never what any result means.
