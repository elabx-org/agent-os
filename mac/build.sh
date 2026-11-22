#!/bin/bash
#
# Builds AgentOS.app (the menu bar app and its window) into mac/build.
# Needs Xcode; no other tools. Signs with $AGENTOS_SIGN_IDENTITY when set,
# otherwise ad hoc, which runs on this Mac only.
#
#   ./build.sh [--out <dir>]      the app, at <dir>/AgentOS.app (default build)
#   ./build.sh --selftest-action  build/agentos-actiontest for ./test.sh action
#
# The build fails when a safety guard fails (see "Guards" below).
set -euo pipefail
cd "$(dirname "$0")"
[ -d /Applications/Xcode.app ] && export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"

OUT=build
ACTION=0
while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="${2:?--out needs a folder}"; shift 2 ;;
    --selftest-action) ACTION=1; shift ;;
    *) echo "build.sh: unknown option $1" >&2; exit 64 ;;
  esac
done

fail() { echo "build.sh: $*" >&2; exit 1; }
# This Mac's own architecture: an Intel Mac (macOS 13 and later) builds and
# runs its own copy, as the app did before this round
SWIFTC=(xcrun swiftc -swift-version 5 -target "$(uname -m)-apple-macos13.0")
FRAMEWORKS=(-framework AppKit -framework WebKit -framework UserNotifications -framework ServiceManagement -framework Security)

# --- Guards on the sources (R2) ---
# Only Click.swift may make a Click.
others=$(grep -ln 'Click(' Sources/*.swift | grep -v '^Sources/Click.swift$' || true)
[ -z "$others" ] || fail "a Click is made outside Click.swift: $others"
# The channel, the poller, the updater, the self-test and the test files
# never reach user proof.
for f in Sources/CommandChannel.swift Sources/Poller.swift Sources/AppUpdater.swift Sources/SelfTest.swift Sources/TestFiles.swift; do
  [ -f "$f" ] || continue
  if grep -nE 'Clicks\.|asUser\(|userCall\(' "$f"; then fail "$f must not reach user proof"; fi
done
# In Notifier.swift, asUser( appears only inside func act(_:record:click:).
if [ -f Sources/Notifier.swift ]; then
  bad=$(awk '
    /func act\(/ { inact = 1; depth = 0; seen = 0 }
    {
      if (!inact && $0 ~ /asUser\(/) print FILENAME ":" NR
      if (inact) {
        n = split($0, chars, "")
        for (i = 1; i <= n; i++) {
          if (chars[i] == "{") { depth++; seen = 1 }
          else if (chars[i] == "}") depth--
        }
        if (seen && depth <= 0) inact = 0
      }
    }' Sources/Notifier.swift)
  [ -z "$bad" ] || fail "asUser( outside act() in $bad"
fi

if [ "$ACTION" = 1 ]; then
  [ -f Tests/ActionTest.swift ] || fail "Tests/ActionTest.swift is missing"
  mkdir -p build/actiontest
  # Top-level code lives in a file named main.swift: the test is copied in
  # as one, beside the app's sources without the app's own main.swift
  cp Tests/ActionTest.swift build/actiontest/main.swift
  "${SWIFTC[@]}" -D SELFTEST "${FRAMEWORKS[@]}" -o build/agentos-actiontest \
    $(ls Sources/*.swift | grep -v '^Sources/main.swift$') Sources/Logic/*.swift build/actiontest/main.swift
  echo "built build/agentos-actiontest"
  exit 0
fi

# --- Stamps ---
ROOT=$(cd .. && pwd)
VERSION=$(/usr/bin/plutil -extract version raw -o - "$ROOT/package.json" 2>/dev/null || echo 0.0.0)
if git -C "$ROOT" rev-parse HEAD >/dev/null 2>&1; then
  COUNT=$(git -C "$ROOT" rev-list --count HEAD)
  COMMIT=$(git -C "$ROOT" rev-parse HEAD)
else
  COUNT=1
  COMMIT=local
fi
HASH_INPUTS=(mac)
[ -f "$ROOT/scripts/agentos-uninstall.sh" ] && HASH_INPUTS+=(scripts/agentos-uninstall.sh)
HASH=$(cd "$ROOT" && find "${HASH_INPUTS[@]}" -type f ! -path 'mac/build/*' -print0 | LC_ALL=C sort -z \
  | xargs -0 shasum -a 256 | shasum -a 256 | cut -c1-16)

# --- The bundle ---
APP="$OUT/AgentOS.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp Info.plist "$APP/Contents/Info.plist"
PLIST="$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $COUNT" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :AgentOSCommit $COMMIT" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :AgentOSSourceHash $HASH" "$PLIST"

"${SWIFTC[@]}" -O "${FRAMEWORKS[@]}" -o "$APP/Contents/MacOS/AgentOS" Sources/*.swift Sources/Logic/*.swift

# The icon, from the web app's
ICONSET=$(mktemp -d "${TMPDIR:-/tmp}/agentos-icon.XXXXXX")/AppIcon.iconset
mkdir -p "$ICONSET"
if (
  set -e
  src=../public/icon-512.png
  for s in 16 32 128 256 512; do
    sips -z $s $s "$src" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
    d=$((s * 2))
    sips -z $d $d "$src" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
  done
  iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"
); then :; else
  echo "build.sh: warning: couldn't make the app icon; building without it" >&2
fi
rm -rf "$(dirname "$ICONSET")"

# The uninstaller, for when ~/.agent-os/repo is already gone
[ -f "$ROOT/scripts/agentos-uninstall.sh" ] && cp "$ROOT/scripts/agentos-uninstall.sh" "$APP/Contents/Resources/"

codesign --force --options runtime --sign "${AGENTOS_SIGN_IDENTITY:--}" "$APP"

# --- Guards on the result (R2) ---
marks=$(strings "$APP/Contents/MacOS/AgentOS" | grep -c AGENTOS_SELFTEST_MARKER || true)
[ "$marks" = 0 ] || fail "the shipped binary holds test code (AGENTOS_SELFTEST_MARKER)"
codesign --verify --strict "$APP" || fail "codesign --verify --strict failed"

# A build folder copy must not stand in for the installed app
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
case "$(cd "$OUT" && pwd)/AgentOS.app" in
  /Applications/AgentOS.app) ;;
  *) "$LSREGISTER" -u "$APP" >/dev/null 2>&1 || true ;;
esac

echo "built $APP hash $HASH commit $COMMIT"
