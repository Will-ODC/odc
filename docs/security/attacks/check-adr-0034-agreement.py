"""Show that each ADR-0034 vector pins a case where the conservative and exact rules agree.

ADR-0034 decision 7: a golden vector for ET-24b may pin only a chain on which
the conservative rule (event-types.md ET-24b) and the exact all-assignments
rule give the same verdict and the same lines. This script reads both rules
directly from their definitions over small abstract chains and prints one row
per vector. It is a declaration aid, not a verifier: it models only the batch
checks (ET-18b, ET-23, ET-24, ET-24a, ET-24b) and trusts Stage A.

An "assignment" gives each opaque ballot at most one issue it is a candidate
of (ET-24b, informative paragraph). The exact rule is the one that paragraph
states: a failure at L is proved when, under every assignment, ET-24 or ET-24a
is broken at or before L by the ballots of L's issue, registered and assigned.
A case is declarable only when the conservative result equals that rule.

For information, the script also evaluates two other readings — the failure
at L itself rather than at or before it, and assignments that must pick an
issue — and flags where they differ. 120 differs under the per-line reading
(the assigned opaque ballot takes the ET-24a failure, so L passes), and the
spec's reading is the one ADR-0034 declares for it (INVALID line 11).

It reads each vector's batch shape from the committed file and its declared
result from contracts/fixtures/index.json, so the check cannot drift from the
golden data. Usage, from anywhere:

    python3 docs/security/attacks/check-adr-0034-agreement.py   # exit 1 on disagreement
"""

import datetime
import itertools
import json
import pathlib
import sys

MINUTE = 60_000


def issue(name, interval=MINUTE, minimum=3):
    return {"kind": "issue", "name": name, "interval": interval, "min": minimum}


def opaque_issue(name):
    return {"kind": "opaque_issue", "name": name}


def number(events):
    """Line 1 is genesis, so the events after it start at line 2. Lines stand in for seq."""
    return [dict(e, line=i + 2) for i, e in enumerate(events)]


def issues_of(chain):
    return {e["name"]: e for e in chain if e["kind"] == "issue"}


def candidates(chain, issue_event):
    return [
        u
        for u in chain
        if u["kind"] == "U"
        and u["line"] > issue_event["line"]
        and u["ts"] % issue_event["interval"] == 0
    ]


def known_ballots(chain, name):
    return [e for e in chain if e["kind"] == "vote" and e["issue"] == name]


def v11_failures(members, minimum):
    """Lines where ET-24 or ET-24a fails over this member sequence (v11 semantics)."""
    failed = set()
    for i, x in enumerate(members):
        if i == 0:
            continue
        p = members[i - 1]
        if p["ts"] == x["ts"]:
            continue
        run = 1
        j = i - 2
        while j >= 0 and members[j]["ts"] == p["ts"]:
            run += 1
            j -= 1
        if run < minimum:
            failed.add(x["line"])  # ET-24: an under-size batch ended by x
        if any(m["ts"] == x["ts"] for m in members[:i]):
            failed.add(x["line"])  # ET-24a: x returns to an instant left
    return failed


def opaque_lines(chain):
    return {e["line"] for e in chain if e["kind"] in ("U", "opaque_issue", "unregistered")}


def et18b_lines(chain):
    unreadable = {e["name"] for e in chain if e["kind"] == "opaque_issue"}
    return {e["line"] for e in chain if e["kind"] == "vote" and e["issue"] in unreadable}


def et23_failures(chain, issues):
    return {
        e["line"]
        for e in chain
        if e["kind"] == "vote" and e["issue"] in issues and e["ts"] % issues[e["issue"]]["interval"] != 0
    }


def verdict(definite, unresolved, opaque):
    if definite:
        return ("INVALID", min(definite))
    lines = sorted(unresolved | opaque)
    if lines:
        return ("PARTIAL", tuple(lines))
    return ("VALID",)


def conservative(chain):
    """ET-24b items 1-5 as written."""
    issues = issues_of(chain)
    definite = set(et23_failures(chain, issues))
    unresolved = set(et18b_lines(chain))
    for name, iss in issues.items():
        c, m = iss["line"], iss["min"]
        cands = candidates(chain, iss)
        known = known_ballots(chain, name)
        for k, L in enumerate(known):
            P = known[k - 1] if k > 0 else None
            run_start = P is not None and P["ts"] != L["ts"]
            known_24a = run_start and any(b["ts"] == L["ts"] for b in known[:k])
            if run_start:
                r_start = k - 1
                while r_start > 0 and known[r_start - 1]["ts"] == P["ts"]:
                    r_start -= 1
                R = known[r_start:k]
                f = R[0]
                w = known[r_start - 1]["line"] if r_start > 0 else c
                t = P["ts"]
                known_24 = len(R) < m
            else:
                known_24 = False
            if known_24a:
                definite.add(L["line"])
                continue
            if known_24:
                F = sum(1 for u in cands if w < u["line"] < L["line"] and u["ts"] == t)
                if len(R) + F < m:
                    definite.add(L["line"])
                else:
                    unresolved.add(L["line"])
                continue
            before = [u for u in cands if u["line"] < L["line"]]
            if run_start:
                hit = any(u["ts"] == L["ts"] or (u["line"] > f["line"] and u["ts"] != t) for u in before)
            else:
                floor = P["line"] if P else c
                hit = any(u["line"] > floor and u["ts"] != L["ts"] for u in before)
            if hit:
                unresolved.add(L["line"])
    return verdict(definite, unresolved, opaque_lines(chain))


def exact(chain, allow_none, at_or_before, chain_level=False):
    """The all-assignments rule, by exhaustive search.

    chain_level: a failure is proved at L when every assignment breaks ET-24 or
    ET-24a at some REGISTERED line of any issue at or before L, not only in L's
    own issue. Breaks at opaque lines are not counted: a verifier can never
    blame an opaque line. It can prove an INVALID the per-issue reading cannot.
    """
    issues = issues_of(chain)
    us = [e for e in chain if e["kind"] == "U"]
    choices = []
    for u in us:
        opts = [n for n, iss in issues.items() if u in candidates(chain, iss)]
        if allow_none or not opts:
            opts = opts + [None]
        choices.append(opts)
    registered = [e for e in chain if e["kind"] == "vote" and e["issue"] in issues]
    outcomes = []  # per assignment: {line: failed?} and per-issue failure lines
    for pick in itertools.product(*choices):
        fails = set()
        by_issue = {}
        for name, iss in issues.items():
            members = sorted(
                known_ballots(chain, name) + [u for u, n in zip(us, pick) if n == name],
                key=lambda e: e["line"],
            )
            f = v11_failures(members, iss["min"])
            by_issue[name] = f
            fails |= f
        outcomes.append((fails, by_issue))
    definite = set(et23_failures(chain, issues))
    unresolved = set(et18b_lines(chain))
    if chain_level:
        reg_lines = {e["line"] for e in registered}
        for L in sorted(reg_lines):
            if all(any(x <= L and x in reg_lines for x in fails) for fails, _ in outcomes):
                definite.add(L)
                break
    for L in registered:
        name = L["issue"]
        if at_or_before:
            each = [any(x <= L["line"] for x in by[name]) for _, by in outcomes]
            mine = [L["line"] in fails for fails, _ in outcomes]
        else:
            each = mine = [L["line"] in fails for fails, _ in outcomes]
        # any(mine): the proved failure is attributed to a line that itself fails
        # under some assignment, so INVALID never names a line that always passes.
        if all(each) and any(mine):
            definite.add(L["line"])
        elif len(set(mine)) > 1:
            unresolved.add(L["line"])
    return verdict(definite, unresolved, opaque_lines(chain))


REGISTERED = {("issue_created", 1), ("vote_cast", 1)}
OTHER_REGISTERED = {("participant_registered", 1)}
# The ET-24b vectors of tools/fixtures-gen/src/vectors/opaque-batching.ts. 130
# is left out on purpose: its malformed payload is an EV-16 Stage A failure
# that no batch rule reaches.
VECTOR_IDS = [f"{n}-" for n in [*range(116, 130), 131, 132, 133, 134]]


def ms(ts):
    return int(datetime.datetime.strptime(ts, "%Y-%m-%dT%H:%M:%S.%f%z").timestamp() * 1000)


def shape(path):
    """The batch shape of a committed vector, read from its own lines."""
    events, names = [], {}
    for line_no, raw in enumerate(path.read_text().splitlines(), start=1):
        e = json.loads(raw)
        kind, version, payload = e["type"], e["version"], e["payload"]
        if line_no == 1:
            continue
        if kind == "issue_created":
            name = f"issue@{line_no}"
            names[e["hash"]] = name
            if (kind, version) in REGISTERED:
                events.append(issue(name, payload["ballot_batch_interval_ms"], payload["ballot_batch_min"]))
            else:
                events.append(opaque_issue(name))
        elif kind == "vote_cast" and (kind, version) in REGISTERED:
            events.append({"kind": "vote", "issue": names.get(payload["issue_id"], "?"), "ts": ms(e["ts"])})
        elif kind == "vote_cast":
            events.append({"kind": "U", "ts": ms(e["ts"])})  # payload deliberately unread
        elif (kind, version) in REGISTERED or (kind, version) in OTHER_REGISTERED:
            events.append({"kind": "other"})
        else:
            # Listed in PARTIAL (EV-7) but never a candidate: only vote_cast carries ballots (ET-22a).
            events.append({"kind": "unregistered"})
    return events


def main():
    root = pathlib.Path(__file__).resolve().parents[3] / "contracts" / "fixtures"
    index = json.loads((root / "index.json").read_text())["vectors"]
    picked = [v for v in index if any(v["id"].startswith(p) for p in VECTOR_IDS)]
    if len(picked) != len(VECTOR_IDS):
        print(f"expected {len(VECTOR_IDS)} vectors, found {len(picked)}")
        return 1
    bad = 0
    for v in picked:
        chain = number(shape(root / v["export"]))
        want = v["expect"]
        declared = (want["verdict"],) + (
            (want["line"],) if "line" in want else (tuple(want["lines"]),) if "lines" in want else ()
        )
        cons = conservative(chain)
        canonical = exact(chain, allow_none=True, at_or_before=True)
        chain_wide = exact(chain, allow_none=True, at_or_before=True, chain_level=True)
        others = {
            "per-line": exact(chain, allow_none=True, at_or_before=False),
            "must-pick": exact(chain, allow_none=False, at_or_before=True),
        }
        # Decision 7 is read strictly: the vector must agree with the per-issue
        # exact rule the spec states AND with the chain-wide reading, so a later
        # tightening in either direction cannot contradict it.
        ok = cons == canonical == chain_wide == declared
        bad += not ok
        note = "".join(f" [{k} reading: {r}]" for k, r in others.items() if r != canonical)
        wide = "" if chain_wide == canonical else f" chain-wide={chain_wide}"
        print(f"{'ok ' if ok else 'BAD'} {v['id']}: conservative={cons} exact={canonical}{wide} declared={declared}{note}")
    print(f"{len(picked) - bad} agree, {bad} disagree ({len(picked)} vectors)")
    return int(bad > 0)


if __name__ == "__main__":
    sys.exit(main())
