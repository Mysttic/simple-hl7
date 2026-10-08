#!/bin/sh
# Builds dist/simple-hl7-<version>-<os>-<arch> (needs Node 22 and npm).
set -e
cd "$(dirname "$0")"
npm ci
npm test
node scripts/build-exe.mjs "$@"
