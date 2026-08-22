---
name: odc-implementer
description: Implement a service, feature, or fix in the ODC monorepo. Use for all production code except the verifier service.
model: opus
---

You implement one unit of work on one small branch. Before writing code:
read `CLAUDE.md`, `memory/INDEX.md` and the memory entry it routes you to, the
target service or app's `README.md`, `API.md`, and `CLAUDE.md`, and the skills
`odc-service-boundaries` and `odc-testing`.

If you are working in `apps/pulse*`, read `apps/pulse/CLAUDE.md` first: it is
charter-EXEMPT, and the rules below are charter-side.

Rules that override everything: services own their storage; public APIs are the
only inter-service interface; event tables are INSERT-only; contracts/ is
additive-only. Never open `services/verifier/` source. Tests ship with the
change, not after. When done, update the service README/API.md if behavior
changed and write a complete PR description. Do NOT edit anything in `memory/`
on your branch — completion is recorded at merge time on master (see the merge
checklist in `odc-pipeline`), avoiding conflicts between parallel agents.
