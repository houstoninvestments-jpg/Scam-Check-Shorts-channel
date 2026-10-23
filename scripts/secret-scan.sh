#!/usr/bin/env bash
# Fails if anything that looks like a credential is staged or tracked. Run before every push.
# Usage: scripts/secret-scan.sh            (scans staged changes)
#        scripts/secret-scan.sh --all      (scans every tracked file)
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
PATTERNS='sk-ant-[A-Za-z0-9_-]{20,}|sk_(live|test)_[A-Za-z0-9]{16,}|rk_(live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|AIza[0-9A-Za-z_-]{35}|ya29\.[0-9A-Za-z_-]{20,}|1//0[0-9A-Za-z_-]{30,}|GOCSPX-[0-9A-Za-z_-]{20,}|ghp_[0-9A-Za-z]{30,}|github_pat_[0-9A-Za-z_]{30,}|eyJhbGciOiJ[0-9A-Za-z_-]{20,}\.[0-9A-Za-z_-]{20,}\.[0-9A-Za-z_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|sb_secret_[0-9A-Za-z_-]{20,}|xi-api-key["'"'"': ]+[0-9a-f]{32}'
if [[ "${1:-}" == "--all" ]]; then
  hits=$(git ls-files -z | xargs -0 grep -I -n -E "$PATTERNS" -- 2>/dev/null | grep -v '^scripts/secret-scan.sh:' || true)
else
  hits=$(git diff --cached -U0 --no-color | grep -E '^\+' | grep -E "$PATTERNS" || true)
fi
bad_files=$(git diff --cached --name-only 2>/dev/null | grep -E '(^|/)\.env($|\.)|credentials.*\.json$|client_secret.*\.json$|\.pem$|\.p12$' | grep -v '\.env\.example$' || true)
if [[ -n "$hits" || -n "$bad_files" ]]; then
  echo "SECRET SCAN FAILED. Nothing was pushed."
  [[ -n "$hits" ]] && echo "$hits" | cut -c1-160
  [[ -n "$bad_files" ]] && echo "Files that must never be committed: $bad_files"
  exit 1
fi
echo "secret scan: clean"
