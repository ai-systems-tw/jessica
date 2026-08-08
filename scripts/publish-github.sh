#!/usr/bin/env bash
set -euo pipefail

repo="${1:-ai-systems-tw/jessica}"

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI (gh) is required in the authenticated environment." >&2
  exit 1
fi

if gh repo view "$repo" >/dev/null 2>&1; then
  git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/${repo}.git"
else
  gh repo create "$repo" --private --source=. --remote=origin
fi

git push -u origin main
