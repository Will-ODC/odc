"""Compare actual CLI output with declared current or proposed batching cases."""

import json
import pathlib
import re
import subprocess
import sys


def main():
    if len(sys.argv) < 4 or sys.argv[1] not in ("current", "proposed"):
        raise SystemExit("usage: check-unknown-batching-proposal.py current|proposed <cases> <verifier> [prefix args]")
    mode = sys.argv[1]
    directory = pathlib.Path(sys.argv[2])
    command = sys.argv[3:]
    cases = json.loads((directory / "index.json").read_text())["cases"]
    if not cases:
        raise SystemExit("no cases: refusing a zero-test result")
    passed = 0
    for case in cases:
        result = subprocess.run(
            [*command, str(directory / case["export"])], capture_output=True, text=True, check=False
        )
        output = result.stdout.strip()
        verdict = output.split()[0] if output else "NO_VERDICT"
        actual = {"verdict": verdict}
        if verdict == "INVALID":
            match = re.match(r"INVALID at line ([1-9][0-9]*)(?::|$)", output)
            actual["line"] = int(match[1]) if match else None
        elif verdict == "PARTIAL":
            match = re.match(r"PARTIAL at lines? ([1-9][0-9]*(?:, *[1-9][0-9]*)*)(?::|$)", output)
            actual["lines"] = [int(n.strip()) for n in match[1].split(",")] if match else None
        expected = case[mode]
        expected_exit = {"VALID": 0, "INVALID": 1, "PARTIAL": 2}[expected["verdict"]]
        ok = actual == expected and result.returncode == expected_exit and len(result.stdout.splitlines()) == 1
        if ok:
            passed += 1
        else:
            print(case["id"], "expected", expected, "observed", actual, "exit", result.returncode)
    failed = len(cases) - passed
    print(f"{mode}: {passed} passed, {failed} failed, 0 skipped ({len(cases)} cases)")
    return int(failed > 0)


if __name__ == "__main__":
    raise SystemExit(main())
