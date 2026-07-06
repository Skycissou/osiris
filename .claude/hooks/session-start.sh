#!/bin/bash
set -euo pipefail

# Install dependencies for OSIRIS so tests/linters/build work in Claude Code on the web.
# Runs only in the remote (web) environment.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Main Next.js app
npm install

# Intel sidecar service
if [ -f intel/package.json ]; then
  (cd intel && npm install)
fi
