#!/bin/bash
#
# Builds AgentOS.app (the menu bar app) into mac/build. Needs Xcode; no
# other tools. Signs with $AGENTOS_SIGN_IDENTITY when set (a Developer ID
# Application identity), otherwise ad hoc, which runs on this Mac only.
set -euo pipefail
cd "$(dirname "$0")"
[ -d /Applications/Xcode.app ] && export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
APP=build/AgentOS.app
rm -rf build && mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp Info.plist "$APP/Contents/Info.plist"
xcrun swiftc -O -swift-version 5 -target "$(uname -m)-apple-macos13.0" \
  -framework AppKit -framework ServiceManagement \
  -o "$APP/Contents/MacOS/AgentOS" Sources/*.swift
codesign --force --options runtime --sign "${AGENTOS_SIGN_IDENTITY:--}" "$APP"
echo "built $(pwd)/$APP"
