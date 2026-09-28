#!/bin/bash
# Claude Code on the web starts from a bare container. This puts Jekyll in place so a session
# can build and check the site (see CLAUDE.md). Local sessions are left alone.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

if ! command -v jekyll >/dev/null 2>&1; then
  gem install jekyll --no-document >/dev/null
fi
# gem's bin folder is not always on PATH in the container
echo "export PATH=\"$(gem environment gemdir)/bin:\$PATH\"" >> "$CLAUDE_ENV_FILE"
echo "jekyll ready: $(gem list jekyll --no-versions 2>/dev/null | head -1 || echo installed)"
