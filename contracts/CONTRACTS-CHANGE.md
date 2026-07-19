# Contracts Change Log

Every pull request that touches `contracts/**` MUST add an entry here, and any
touched **spec** file (`contracts/*.md` other than `README.md` and this file)
MUST also add or bump its own `Version:` line. The `contracts-guard` CI
workflow enforces both on every PR.

After the `contracts-v1` tag exists, `hashing.md` and `fixtures/` are frozen:
CI hard-fails any edit to them. All other post-freeze changes stay
additive-only, version-bumped, and logged here — never retroactive.

Format (newest first, one entry per merged contracts change):

    ## <spec or scope> — <version> — <YYYY-MM-DD> — <PR>
    - what changed, and why (one or two lines)

---

## tooling — n/a — 2026-07-19 — T2

- Introduced this changelog and the `contracts-guard` CI workflow. No spec
  content yet; `contracts/` stays in DRAFTING status (see `contracts/README.md`).
  Spec drafting begins in T3.
