"""Check ADR-0032 against a verifier CLI using immutable and temporary inputs."""

import json
import pathlib
import subprocess
import sys
import tempfile


def main():
    root = pathlib.Path(__file__).resolve().parents[3]
    command = sys.argv[1:]
    if not command:
        raise SystemExit("usage: check-anchor-policy.py <verifier> [prefix args]")
    fixtures = root / "contracts" / "fixtures"
    vectors = json.loads((fixtures / "index.json").read_text())["vectors"]
    def by_prefix(prefix):
        return next(v for v in vectors if v["id"].startswith(prefix))
    checks = 0

    def run(name, path, verdict, line=None, flags=(), claims=None):
        nonlocal checks
        result = subprocess.run(
            [*command, str(path), *flags], capture_output=True, text=True, check=False
        )
        expected_exit = {"VALID": 0, "INVALID": 1, "PARTIAL": 2}[verdict]
        assert result.returncode == expected_exit, (name, result.returncode)
        output = result.stdout.strip()
        assert len(result.stdout.splitlines()) == 1, (name, "stdout shape")
        if verdict == "INVALID":
            assert output.startswith(f"INVALID at line {line}:"), (name, output)
        else:
            assert output.split()[0] == verdict, (name, output)
        if claims is not None:
            expected = [f"genesis: {claims[0]}", f"head: {claims[1]}"]
            assert result.stderr.splitlines() == expected, (name, "stored claims")
        checks += 1

    valid = by_prefix("002-")
    path = fixtures / valid["export"]
    events = [json.loads(line) for line in path.read_text().splitlines()]
    first, last = events[0]["hash"], events[-1]["hash"]
    wrong = "0" * 64
    run("clean", path, "VALID", claims=(first, last))
    run("both anchors match", path, "VALID", flags=("--chain", first, "--head", last))
    run("wrong chain", path, "INVALID", 1, flags=("--chain", wrong))
    run("wrong head", path, "INVALID", len(events), flags=("--chain", first, "--head", wrong))
    run("both wrong", path, "INVALID", 1, flags=("--chain", wrong, "--head", wrong))
    for prefix in ("037-", "057-"):
        vector = by_prefix(prefix)
        run(
            "file error precedes anchors " + prefix,
            fixtures / vector["export"],
            "INVALID",
            vector["expect"]["line"],
            flags=("--chain", wrong, "--head", wrong),
        )
    partial = next(v for v in vectors if v["expect"]["verdict"] == "PARTIAL")
    partial_path = fixtures / partial["export"]
    partial_events = [json.loads(line) for line in partial_path.read_text().splitlines()]
    partial_claims = (partial_events[0]["hash"], partial_events[-1]["hash"])
    run("partial", partial_path, "PARTIAL", claims=partial_claims)
    run("partial wrong chain", partial_path, "INVALID", 1, flags=("--chain", wrong), claims=partial_claims)

    genesis = json.loads((fixtures / "vectors" / "001-genesis-only.ndjson").read_text())
    original = genesis["hash"]
    genesis["hash"] = ("0" if original[0] != "0" else "1") + original[1:]
    changed = genesis["hash"]
    canonical = (fixtures / "vectors" / "001-genesis-only.ndjson").read_bytes()
    cases = [
        ("hash mismatch", (json.dumps(genesis, separators=(",", ":")) + "\n").encode(), (changed, changed)),
        ("not JSON", b"not JSON\n", ("unavailable", "unavailable")),
        ("missing hash", b"{}\n", ("unavailable", "unavailable")),
        ("missing final LF", canonical[:-1], (original, original)),
        ("leading broken record", b"not JSON\n" + canonical, ("unavailable", original)),
        ("trailing blank record", canonical + b"\n", (original, "unavailable")),
        ("repeated hash claim", ('{"hash":"' + original + '","hash":"' + changed + '"}\n').encode(), (changed, changed)),
    ]
    with tempfile.TemporaryDirectory(prefix="odc-anchor-policy-") as directory:
        for name, data, claims in cases:
            case = pathlib.Path(directory) / "case.ndjson"
            case.write_bytes(data)
            line = 2 if name == "trailing blank record" else 1
            run(name, case, "INVALID", line, claims=claims)
    print(f"PASS {checks} anchor/report policy checks")


if __name__ == "__main__":
    main()
