#!/bin/bash
#
# A linked machine: this AgentOS runs sessions here and is opened from
# another AgentOS (the one you use on your phone). `agent-os link ...`
# lands here. Works with the bash that ships with macOS (3.2).
#
#   link <invite>   set this machine up from the command AgentOS gave you
#   on | off        connect / disconnect (off: nothing can reach this machine)
#   status          where the link stands
#   signin          sign in again
#   remove          disconnect for good and forget the key
#   run             (the service) run the server in the foreground
#   update <sha>    (the server) switch to the hub's version, with rollback

set -u

AGENT_OS_HOME="${AGENT_OS_HOME:-$HOME/.agent-os}"
PORT="${AGENT_OS_PORT:-3011}"
REPO_URL="https://github.com/elabx-org/agent-os.git"
REPO_DIR="$AGENT_OS_HOME/repo"
LABEL="com.agentos.machine"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$AGENT_OS_HOME/logs"
export AGENT_OS_HOME

# Homebrew, the Claude CLI and friends, wherever the service starts from
for dir in "$HOME/.local/bin" /opt/homebrew/bin /opt/homebrew/sbin /usr/local/bin; do
  case ":$PATH:" in *":$dir:"*) ;; *) [ -d "$dir" ] && PATH="$dir:$PATH" ;; esac
done
export PATH

say() { printf '%s\n' "$*"; }
die() { printf '%s\n' "$*" >&2; exit 1; }
is_mac() { [ "$(uname -s)" = Darwin ]; }
tsx() { (cd "$REPO_DIR" && node_modules/.bin/tsx "$@"); }
link_cli() { tsx scripts/agentos-link.ts "$@"; }

service_loaded() { launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; }

service_install() {
  is_mac || die "Starting at login is set up for macOS only; run:  $0 run"
  mkdir -p "$(dirname "$PLIST")" "$LOG_DIR"
  cat >"$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$REPO_DIR/scripts/agentos-machine.sh</string>
    <string>run</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>WorkingDirectory</key><string>$HOME</string>
  <key>StandardOutPath</key><string>$LOG_DIR/machine.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/machine.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>AGENT_OS_HOME</key><string>$AGENT_OS_HOME</string>
    <key>AGENT_OS_PORT</key><string>$PORT</string>
  </dict>
</dict>
</plist>
PLIST
}

service_start() {
  service_loaded && return 0
  launchctl bootstrap "gui/$(id -u)" "$PLIST" || die "Couldn't start the AgentOS service."
}

service_stop() {
  service_loaded || return 0
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
}

service_restart() {
  if is_mac && service_loaded; then
    launchctl kickstart -k "gui/$(id -u)/$LABEL"
  else
    # No service manager: whoever started `run` restarts it
    pkill -f "$REPO_DIR/node_modules/.bin/tsx server.ts" 2>/dev/null || true
  fi
}

healthy() {
  curl -fsS -m 5 -o /dev/null "http://127.0.0.1:$PORT/api/build"
}

cmd_run() {
  [ -d "$REPO_DIR" ] || die "AgentOS isn't installed in $REPO_DIR"
  mkdir -p "$LOG_DIR"
  cd "$REPO_DIR" || exit 1
  export DB_PATH="${DB_PATH:-$AGENT_OS_HOME/agent-os.db}"
  export NODE_ENV=production PORT
  exec node_modules/.bin/tsx server.ts
}

cmd_link() {
  [ -n "${1:-}" ] || die "Copy the whole command from AgentOS: Settings, Machines, Add a Mac."
  [ -d "$REPO_DIR/node_modules" ] || die "AgentOS isn't installed yet."
  link_cli setup "$1" || exit 1
  if is_mac; then
    service_install
    service_stop
    service_start
  else
    say "Start it with:  $0 run"
    return 0
  fi
  say ""
  link_cli wait
  code=$?
  [ "$code" = 0 ] && say "" && say "Done. This Mac now shows in AgentOS. You can close this window."
  return "$code"
}

cmd_on() {
  [ -f "$AGENT_OS_HOME/link.json" ] || die "This machine isn't linked. Add it from AgentOS: Settings, Machines."
  service_install
  service_start
  say "On. $(link_cli status)"
}

cmd_off() {
  service_stop
  say "Off. Nothing can reach this machine until you run:  agent-os link on"
}

cmd_remove() {
  service_stop
  rm -f "$PLIST"
  [ -d "$REPO_DIR/node_modules" ] && link_cli forget
  say "Removed. Also remove it in AgentOS (Settings, Machines) if it still shows there."
}

# Switch to the hub's commit: build beside the running copy, swap, restart,
# and go back to the old copy if the new one doesn't come up
cmd_update() {
  sha="${1:-}"
  case "$sha" in *[!0-9a-f]*|"") die "update: not a commit" ;; esac
  [ "${#sha}" = 40 ] || die "update: not a commit"
  lock="$AGENT_OS_HOME/update.lock"
  mkdir "$lock" 2>/dev/null || { say "update: already running"; return 0; }
  trap 'rmdir "$lock" 2>/dev/null' EXIT
  mkdir -p "$LOG_DIR"
  log="$LOG_DIR/update.log"
  {
    echo "== $(date) updating to $sha"
    cd "$AGENT_OS_HOME" || exit 1
    rm -rf repo-next
    git clone -q "$REPO_URL" repo-next && cd repo-next && git checkout -q "$sha" || { echo "that commit isn't on GitHub"; exit 1; }
    npm install --legacy-peer-deps >/dev/null 2>&1 || npm install --legacy-peer-deps || { echo "install failed"; exit 1; }
    NODE_ENV=production npm run build >/dev/null 2>&1 || NODE_ENV=production npm run build || { echo "build failed"; exit 1; }
    cd "$AGENT_OS_HOME" || exit 1
    rm -rf repo-prev
    mv repo repo-prev && mv repo-next repo || { echo "swap failed"; [ -d repo ] || mv repo-prev repo; exit 1; }
    service_restart
    ok=0
    i=0
    while [ "$i" -lt 45 ]; do
      sleep 2
      healthy && { ok=1; break; }
      i=$((i + 1))
    done
    if [ "$ok" = 1 ]; then
      echo "now on $sha"
    else
      echo "new version didn't come up: going back"
      rm -rf repo-bad
      mv repo repo-bad && mv repo-prev repo
      service_restart
    fi
  } >>"$log" 2>&1
}

case "${1:-}" in
  link) shift; cmd_link "$@" ;;
  on) cmd_on ;;
  off) cmd_off ;;
  status) [ -d "$REPO_DIR/node_modules" ] && link_cli status || say "Not installed" ;;
  signin) link_cli signin && service_restart ;;
  remove) cmd_remove ;;
  run) cmd_run ;;
  update) shift; cmd_update "$@" ;;
  *) sed -n '3,15p' "$0"; exit 1 ;;
esac
