"""Observe Phase 4 reporting policy without changing golden fixtures."""

import json
import pathlib
import subprocess
import sys
import tempfile


def main():
    root = pathlib.Path(__file__).resolve().parents[3]
    command = sys.argv[1:]
    if not command:
        raise SystemExit("usage: probe-phase4-reporting.py <verifier> [prefix args]")
    fixtures = root / "contracts" / "fixtures"
    vectors = json.loads((fixtures / "index.json").read_text())["vectors"]
    clean = fixtures / "vectors" / "001-genesis-only.ndjson"
    invalid = next(v for v in vectors if v["id"].startswith("037-"))

    def run(path, *flags):
        result = subprocess.run(
            [*command, str(path), *flags], capture_output=True, text=True, check=False
        )
        assert len(result.stdout.splitlines()) == 1, "stdout must be one verdict line"
        labels = [line.split(":", 1)[0] for line in result.stderr.splitlines()]
        assert labels == ["genesis", "head"], "non-empty exports need both reports"
        return result

    result = run(clean)
    assert result.returncode == 0 and result.stdout.strip() == "VALID"
    result = run(clean, "--chain", "0" * 64)
    assert result.returncode == 1 and result.stdout.startswith("INVALID at line 1:")
    print("PASS clean export, wrong chain, one verdict line and both report labels")

    result = run(fixtures / invalid["export"], "--chain", "0" * 64)
    assert result.returncode == 1, "the file must remain INVALID"
    print("Wrong chain plus existing file error:", result.stdout.strip())

    event = json.loads(clean.read_text())
    original = event["hash"]
    event["hash"] = ("0" if original[0] != "0" else "1") + original[1:]
    with tempfile.TemporaryDirectory(prefix="odc-report-probe-") as directory:
        path = pathlib.Path(directory) / "hash-mismatch.ndjson"
        path.write_text(json.dumps(event, separators=(",", ":")) + "\n")
        result = run(path)
    assert result.returncode == 1 and result.stdout.startswith("INVALID at line 1:")
    print("Hash mismatch reports stored hash:", event["hash"] in result.stderr)
    print("Hash mismatch reports original recomputed hash:", original in result.stderr)


if __name__ == "__main__":
    main()
