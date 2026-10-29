#!/usr/bin/env bash
set -euo pipefail
cd "${1:-$(cd "$(dirname "$0")/.." && pwd)}"
if command -v go >/dev/null 2>&1; then
  go_bin=go
elif [[ -x /usr/local/go/bin/go ]]; then
  go_bin=/usr/local/go/bin/go
else
  printf '%s\n' 'Go is required to verify this push.' >&2
  exit 1
fi
"$go_bin" test -race ./...
"$go_bin" vet ./...
for source in web/*.js; do node --check "$source"; done
node --test tests/*.test.cjs
python3 -m unittest discover -s tests -p 'test_*.py'
python3 scripts/check_fct_coverage.py
