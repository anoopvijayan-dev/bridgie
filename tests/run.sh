#!/usr/bin/env bash
# Run every check: shellcheck (if present), node unit tests, bats CLI tests, doctor.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
export BRIDGIE_USER_POLICY=/nonexistent/bridgie-user-policy.yaml   # isolate tests from ~/.bridgie
if command -v shellcheck >/dev/null 2>&1; then
  shellcheck -x -S warning bin/bridgie bin/install.sh runner/lib/*.sh runner/cmd/*.sh adapters/*/run.sh adapters/lib/*.sh tests/*.bash
else
  echo "shellcheck not installed; skipping (apt install shellcheck / brew install shellcheck)"
fi
node --test runner/*.test.mjs
bats tests/
bin/bridgie doctor
echo "ALL GREEN"
