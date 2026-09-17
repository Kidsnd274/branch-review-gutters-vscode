#!/usr/bin/env bash
# Full release build: icon, compile, tests, package. Produces
# branch-review-gutters-<version>.vsix in the repository root.
set -euo pipefail
cd "$(dirname "$0")/.."

./scripts/build-icon.sh
npm run compile
npm test
npx vsce package --no-dependencies
