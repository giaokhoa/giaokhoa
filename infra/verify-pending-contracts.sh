#!/usr/bin/env bash
# Contract-first revocation tests: CI verifies expected RED signatures without masking setup/HTTP failures.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPORT="$ROOT/backend/target/failsafe-reports/TEST-com.giaokhoa.authorization.ConcurrentRevocationIT.xml"
LOG="$(mktemp)"
trap 'rm -f "$LOG"' EXIT
rm -f "$REPORT"

set +e
"$ROOT/backend/mvnw" -B -ntp -f "$ROOT/backend/pom.xml" -Pintegration \
  -Dgroups=pending-contract '-DpendingContract.excludedGroups=' "$@" verify > "$LOG" 2>&1
code=$?
set -e
if [[ "$code" -eq 0 ]]; then
  echo "Pending contract suite unexpectedly passed; promote GREEN tests to mandatory CI." >&2
  exit 1
fi

if ! grep -q 'Failed to execute goal org.apache.maven.plugins:maven-failsafe-plugin' "$LOG"; then
  echo "Pending contract run failed outside Failsafe assertions" >&2
  tail -50 "$LOG" >&2
  exit 1
fi

if ! python3 - "$REPORT" <<'PY'
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

path = Path(sys.argv[1])
if not path.is_file():
    raise AssertionError("Pending contract Failsafe report missing: setup/build failure, not contract RED")
suite = ET.parse(path).getroot()
if (int(suite.get("tests", 0)), int(suite.get("failures", 0)),
        int(suite.get("errors", 0)), int(suite.get("skipped", 0))) != (5, 5, 0, 0):
    raise AssertionError("Pending contract verifier expects exactly 5 assertion REDs, zero errors/skips")
cases = suite.findall("testcase")
stem = "protectedCapabilitiesMustRejectCommittedPendingDependency(PendingScope)"
scopes = ("ACCOUNT", "WORKSPACE", "GRANT_PENDING", "GRANT_FAILED")
expected = {f"{stem}[{i}]": name for i, name in enumerate(scopes, 1)}
concurrent = "concurrentFixtureMutationMustWaitForDatabaseRevocationFence"
expected.update({concurrent: None})
if len(cases) != len(expected) or {c.get("name") for c in cases} != set(expected):
    raise AssertionError("Pending contract test identities changed; review them before updating CI")

for case in cases:
    name = case.get("name")
    failure = case.find("failure")
    if failure is None or case.find("error") is not None:
        raise AssertionError(f"{name}: expected assertion RED, not pass/setup error")
    message = failure.get("message", "")
    if name == concurrent:
        if message != (
                "REVOCATION_CONTRACT_EARLY_HTTP_STATUS=404 before PostgreSQL fence: "
                "sample action route absent"):
            raise AssertionError(
                "Concurrent failure is not missing route (HTTP 400/403/302/200 are NOT expected RED)")
        continue
    scope = expected[name]
    grant = scope.startswith("GRANT_")
    assertions = [
        f"REVOCATION_CONTRACT_READY_AND_FENCED_{scope} ({3 if grant else 2} failures)",
        f"REVOCATION_CONTRACT_READY_EXPECT_ALLOW_A_BEFORE_{scope} ==> expected: <200> but was: <404>",
        f"REVOCATION_CONTRACT_FENCED_EXPECT_503_{scope} actual HTTP=404 ==> expected: <503> but was: <404>",
    ]
    if grant:
        assertions.append(
            f"REVOCATION_CONTRACT_READY_EXPECT_ALLOW_INDEPENDENT_B_AFTER_{scope}"
            " ==> expected: <200> but was: <404>")
    if any(check not in message for check in assertions):
        raise AssertionError(f"{scope}: missing READY/503/independent-B contrast or HTTP status changed")
print("Pending contracts: 5 deliberate REDs verified (READY/503/B, early HTTP 404)")
PY
then
  tail -70 "$LOG" >&2
  exit 1
fi
