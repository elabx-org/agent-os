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
    # The stub action test: a stub AgentOS on 39011 (never the real one),
    # the test binary built with -D SELFTEST, every action through it
    PORT=39011
    if curl -s -m 1 "http://127.0.0.1:$PORT/api/build" >/dev/null 2>&1; then
      echo "test.sh: something already listens on $PORT" >&2
      exit 1
    fi
    ./build.sh --selftest-action
    node Tests/stub-server.mjs "$PORT" >build/stub.out 2>&1 &
    STUB=$!
    trap 'kill $STUB 2>/dev/null || true' EXIT
    for _ in $(seq 1 50); do
      curl -s -m 1 "http://127.0.0.1:$PORT/api/build" >/dev/null 2>&1 && break
      sleep 0.1
    done
    AGENT_OS_PORT=$PORT build/agentos-actiontest
    ;;
  *)
    echo "usage: ./test.sh [action]" >&2
    exit 64
    ;;
esac
