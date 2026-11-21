#!/bin/bash
#
#   ./test.sh          the pure tests (Sources/Logic + Tests/main.swift)
#   ./test.sh action   the stub action test (Stage 2)
set -euo pipefail
cd "$(dirname "$0")"
[ -d /Applications/Xcode.app ] && export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
mkdir -p build

case "${1:-}" in
  "")
    xcrun swiftc -swift-version 5 Sources/Logic/*.swift Tests/main.swift -o build/logic-tests
    build/logic-tests
    ;;
  action)
    echo "test.sh: the action test arrives with Stage 2" >&2
    exit 64
    ;;
  *)
    echo "usage: ./test.sh [action]" >&2
    exit 64
    ;;
esac
