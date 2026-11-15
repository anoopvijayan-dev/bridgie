#!/usr/bin/env bash
# Run every check: shellcheck on the remaining shell (if present), node unit tests, bats CLI tests, doctor.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
export BRIDGIE_USER_POLICY=/nonexistent/bridgie-user-policy.yaml   # isolate tests from ~/.bridgie
if command -v shellcheck >/dev/null 2>&1; then
  shellcheck -x -S warning bin/bridgie bin/install.sh tests/*.bash tests/run.sh
else
  echo "shellcheck not installed; skipping (apt install shellcheck / brew install shellcheck)"
fi
node --test
bats tests/
node bin/bridgie.mjs doctor
echo "ALL GREEN"
