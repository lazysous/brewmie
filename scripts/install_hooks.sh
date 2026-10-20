#!/usr/bin/env bash
# Points this clone at the versioned hooks in scripts/git-hooks (secret guard).
# Run once after cloning; worktrees share the setting with their main clone.
set -euo pipefail
cd "$(dirname "$0")/.."
chmod +x scripts/git-hooks/pre-commit
git config core.hooksPath scripts/git-hooks
echo "hooks installed: core.hooksPath = $(git config --get core.hooksPath)"
