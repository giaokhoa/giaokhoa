#!/usr/bin/env bash
# T014 test-first: fail CI if the five missing-behavior proofs silently disappear or change.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPORT="$ROOT/backend/target/failsafe-reports/TEST-com.giaokhoa.authorization.ConcurrentRevocationIT.xml"
LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT
rm -f "$REPORT"

set +e
"$ROOT/backend/mvnw" -B -ntp -f "$ROOT/backend/pom.xml" -Pintegration \
  -Dgroups=t014-pending '-Dt014.excludedGroups=' "$@" verify > "$LOG" 2>&1
code=$?
set -e
if [[ "$code" -eq 0 ]]; then
  echo "T014 expected RED suite unexpectedly passed; promote GREEN tests to mandatory CI." >&2
  exit 1
fi

if ! python3 - "$REPORT" <<'PY'
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

path = Path(sys.argv[1])
if not path.is_file():
    raise AssertionError("T014 Failsafe report missing (setup/build failure, not contract RED)")
suite = ET.parse(path).getroot()
if (int(suite.get("tests", 0)), int(suite.get("failures", 0)), int(suite.get("errors", 0))) != (5, 5, 0):
    raise AssertionError("T014 requires exactly five assertion REDs and zero setup errors")
cases = suite.findall("testcase")
if len(cases) != 5:
    raise AssertionError("Unexpected T014 test case count")
names = [c.get("name", "") for c in cases]
if len(set(names)) != 5:
    raise AssertionError("Duplicate T014 test names")
for case in cases:
    failure = case.find("failure")
    if failure is None:
        raise AssertionError("T014 test passed or errored unexpectedly: " + case.get("name", ""))
    message = failure.get("message", "")
    name = case.get("name", "")
    if name.startswith("protectedCapabilitiesMustRejectCommittedPendingDependency("):
        if "expected: <503> but was: <404>" not in message:
            raise AssertionError("PENDING/FAILED contract no longer RED for missing endpoint: " + name)
    elif name == "concurrentFixtureMutationMustWaitForDatabaseRevocationFence":
        if "PostgreSQL lock" not in message:
            raise AssertionError("Concurrent contract no longer RED for missing fence")
    else:
        raise AssertionError("Unexpected T014 case: " + name)
print("T014: five expected contract REDs verified; no fixture/setup errors")
PY
then
  tail -70 "$LOG" >&2
  exit 1
fi
