#!/bin/sh
# agentos-browser: $BROWSER for Agent-OS sessions.
#
# CLIs (claude, codex login, gemini, gh auth login --web) call $BROWSER with
# a sign-in link. There is no browser in the container, so this sends the
# link to Agent-OS, which shows it as a toast ("Open sign-in link") and, for
# localhost:PORT links, opens them through the port proxy (/proxy/PORT/...).
# It also prints the link, and always exits 0 so the CLI carries on to its
# "paste the code" fallback.
#
# Installed by Agent-OS to $AGENT_OS_HOME/bin/agentos-browser; AGENTOS_URL is
# the server on loopback. Runs inside the user's live sessions: keep it tiny.

url="$1"
[ -n "$url" ] || exit 0

base="${AGENTOS_URL:-http://127.0.0.1:3011}"
session=""
if [ -n "$TMUX" ] && command -v tmux >/dev/null 2>&1; then
  session=$(tmux display-message -p '#{session_name}' 2>/dev/null || true)
fi

# JSON string: escape backslash and double quote, drop control characters
json_string() {
  printf '%s' "$1" | tr -d '\000-\037' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

open_url=""
if command -v curl >/dev/null 2>&1; then
  body=$(printf '{"url":"%s","session":"%s"}' "$(json_string "$url")" "$(json_string "$session")")
  resp=$(curl -fsS -m 3 -H 'Content-Type: application/json' \
    -H 'X-Agentos-Browser: 1' --data "$body" \
    "$base/api/browser-open" 2>/dev/null || true)
  open_url=$(printf '%s' "$resp" | sed -n 's/.*"open":"\([^"]*\)".*/\1/p' | sed 's/\\\//\//g')
  case "$resp" in
    *'"ok":true'*) sent=1 ;;
    *) sent=0 ;;
  esac
else
  sent=0
fi

echo ""
if [ "$sent" = 1 ]; then
  echo "Open this link (also sent to Agent-OS):"
else
  echo "Open this link:"
fi
echo ""
echo "  ${open_url:-$url}"
echo ""
if [ -n "$open_url" ] && [ "$open_url" != "$url" ]; then
  echo "(It reaches $url through Agent-OS's port proxy.)"
  echo ""
elif [ -z "$open_url" ]; then
  port_path=$(printf '%s' "$url" | sed -n 's#^https\{0,1\}://\(localhost\|127\.0\.0\.1\):\([0-9][0-9]*\)\(.*\)$#\2\3#p')
  if [ -n "$port_path" ]; then
    echo "If it doesn't load, open <your Agent-OS address>/proxy/$port_path"
    echo ""
  fi
fi
exit 0
