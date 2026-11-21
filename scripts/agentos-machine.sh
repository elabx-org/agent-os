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
#   app [update]    build the menu bar app from this copy and swap it in
#   app check       whether the app is current, out of date or missing
#   app install --from <AgentOS.app>   stage a build (for builders)
#   app rollback    go back to the app before the last update
#
# To remove AgentOS from this Mac: agent-os uninstall

set -u

AGENT_OS_HOME="${AGENT_OS_HOME:-$HOME/.agent-os}"
PORT="${AGENT_OS_PORT:-3011}"
REPO_URL="https://github.com/elabx-org/agent-os.git"
REPO_DIR="$AGENT_OS_HOME/repo"
LABEL="com.agentos.machine"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$AGENT_OS_HOME/logs"
export AGENT_OS_HOME

# The menu bar app (mac/): built here, staged in mac-app/next, swapped in
# by the app itself. AGENTOS_APP_SRC builds from another checkout (builders);
# AGENTOS_APP_TEST_ROOT moves every app path into a test folder, so tests
# never reach /Applications.
APP_SRC="${AGENTOS_APP_SRC:-$REPO_DIR}"
if [ -n "${AGENTOS_APP_TEST_ROOT:-}" ]; then
  APP_DIRS=("$AGENTOS_APP_TEST_ROOT/Applications/AgentOS.app" "$AGENTOS_APP_TEST_ROOT/HomeApplications/AgentOS.app")
  MACAPP="$AGENTOS_APP_TEST_ROOT/mac-app"
  APP_LOCK="$AGENTOS_APP_TEST_ROOT/app.lock"
  APP_LOG_DIR="$AGENTOS_APP_TEST_ROOT/logs"
else
  APP_DIRS=("/Applications/AgentOS.app" "$HOME/Applications/AgentOS.app")
  MACAPP="$AGENT_OS_HOME/mac-app"
  APP_LOCK="$AGENT_OS_HOME/app.lock"
  APP_LOG_DIR="$LOG_DIR"
fi
APP_STATE="$MACAPP/app-update.json"
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister

# Homebrew, the Claude CLI and friends, wherever the service starts from
for dir in "$HOME/.local/bin" /opt/homebrew/bin /opt/homebrew/sbin /usr/local/bin; do
  case ":$PATH:" in *":$dir:"*) ;; *) [ -d "$dir" ] && PATH="$dir:$PATH" ;; esac
done
export PATH

# A Node this AgentOS's native modules have builds for (20 to 24). A newer
# default (Homebrew's is the latest) can't compile them: use node@22 beside
# it when it's there. The installer and the service decide the same way.
node_ok() {
  local major
  major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
  [ "$major" -ge 20 ] && [ "$major" -le 24 ]
}
use_node22() {
  local dir
  for dir in /opt/homebrew/opt/node@22/bin /usr/local/opt/node@22/bin; do
    [ -x "$dir/node" ] && PATH="$dir:$PATH" && export PATH && return 0
  done
  return 1
}
node_ok || use_node22 || true

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

# --- The menu bar app ---------------------------------------------------

plist_get() { /usr/libexec/PlistBuddy -c "Print :$2" "$1/Contents/Info.plist" 2>/dev/null; }

# The installed app: the first fixed path holding our bundle
app_path() {
  local p
  for p in "${APP_DIRS[@]}"; do
    [ -d "$p" ] && [ "$(plist_get "$p" CFBundleIdentifier)" = com.agentos.mac ] && { printf '%s' "$p"; return 0; }
  done
  return 1
}

# The source hash a build of this copy would carry (the recipe in mac/build.sh)
app_want_hash() {
  (
    cd "$APP_SRC" 2>/dev/null || exit 1
    [ -d mac ] || exit 1
    set -- mac
    [ -f scripts/agentos-uninstall.sh ] && set -- mac scripts/agentos-uninstall.sh
    find "$@" -type f ! -path 'mac/build/*' -print0 | LC_ALL=C sort -z | xargs -0 shasum -a 256 | shasum -a 256 | cut -c1-16
  )
}

app_have_hash() {
  local app
  app=$(app_path) || return 0
  plist_get "$app" AgentOSSourceHash | grep -E '^[0-9a-f]{16}$'
}

app_note() {
  mkdir -p "$APP_LOG_DIR"
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >>"$APP_LOG_DIR/app-build.log"
}

app_state() { # state hash error
  local err=null
  [ -n "${3:-}" ] && err="\"$(printf '%s' "$3" | tr -d '"\\')\""
  mkdir -p "$MACAPP"
  printf '{"state":"%s","hash":"%s","at":"%s","error":%s}\n' "$1" "$2" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$err" \
    >"$APP_STATE.tmp" && mv "$APP_STATE.tmp" "$APP_STATE"
}

# One build at a time. The lock holds the builder's pid (its own, also in a
# subshell, where $$ would be the parent's); a lock whose builder is gone,
# or older than an hour, is taken over.
app_lock() {
  local pid
  if ! mkdir "$APP_LOCK" 2>/dev/null; then
    pid=$(cat "$APP_LOCK/pid" 2>/dev/null)
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && [ -z "$(find "$APP_LOCK" -maxdepth 0 -mmin +60 2>/dev/null)" ]; then
      return 1
    fi
    rm -rf "$APP_LOCK"
    mkdir "$APP_LOCK" 2>/dev/null || return 1
  fi
  sh -c 'echo $PPID' >"$APP_LOCK/pid"
}
app_unlock() { rm -rf "$APP_LOCK"; }

# A built app is ours and whole: signature, bundle id, and --version names the hash
app_verify() { # bundle hash
  codesign --verify --strict "$1" 2>/dev/null || { echo "its signature doesn't check out"; return 1; }
  [ "$(plist_get "$1" CFBundleIdentifier)" = com.agentos.mac ] || { echo "it isn't the AgentOS app"; return 1; }
  "$1/Contents/MacOS/AgentOS" --version 2>/dev/null | grep -qF "hash $2" || { echo "it isn't the version that was built"; return 1; }
}

# Builds this copy's app into mac-app/next and marks it ready. Never fails
# its caller's work: a failure is logged and written to app-update.json.
app_stage() {
  is_mac || return 1
  xcrun -f swiftc >/dev/null 2>&1 || { app_note "no Xcode tools: the app wasn't updated"; return 1; }
  app_lock || { app_note "an app build is already running"; return 1; }
  local want why
  want=$(app_want_hash)
  [ -n "$want" ] || { app_unlock; app_note "no app source in $APP_SRC"; return 1; }
  mkdir -p "$MACAPP" "$APP_LOG_DIR"
  rm -rf "$MACAPP/next"
  app_note "building the app $want from $APP_SRC"
  if ! { bash "$APP_SRC/mac/test.sh" && bash "$APP_SRC/mac/build.sh" --out "$MACAPP/next"; } >>"$APP_LOG_DIR/app-build.log" 2>&1; then
    rm -rf "$MACAPP/next"
    app_state failed "$want" "the build failed"
    app_note "the app build failed"
    app_unlock
    return 1
  fi
  if ! why=$(app_verify "$MACAPP/next/AgentOS.app" "$want"); then
    rm -rf "$MACAPP/next"
    app_state failed "$want" "$why"
    app_note "the built app was refused: $why"
    app_unlock
    return 1
  fi
  "$LSREGISTER" -u "$MACAPP/next/AgentOS.app" >/dev/null 2>&1
  printf '%s\n' "$want" >"$MACAPP/next/ready"
  app_state staged "$want" ""
  app_note "staged the app $want"
  app_unlock
  say "The menu bar app is ready ($want)."
}

app_running_from() { # bundle -> pid
  local exe="$1/Contents/MacOS/AgentOS" pid
  for pid in $(pgrep -x AgentOS 2>/dev/null); do
    [ "$(ps -o comm= -p "$pid" 2>/dev/null)" = "$exe" ] && { printf '%s' "$pid"; return 0; }
  done
  return 1
}

open_app() { # bundle args...
  local app="$1"
  shift
  if [ -n "${AGENTOS_APP_TEST_ROOT:-}" ]; then
    open -g -j --env "AGENTOS_APP_TEST_ROOT=$AGENTOS_APP_TEST_ROOT" "$app" --args "$@"
  else
    open -g -j "$app" --args "$@"
  fi
}

# Hands a staged app over. A running app with the updater picks next/ready
# up by itself. Otherwise the app is opened to swap it in; with no app, or
# one from before the updater, the staged copy installs itself.
app_kick() {
  is_mac || return 0
  [ -f "$MACAPP/next/ready" ] || return 0
  app_running_from "$MACAPP/next/AgentOS.app" >/dev/null && return 0
  local app
  app=$(app_path) || app=""
  if [ -n "$app" ] && [ -n "$(app_have_hash)" ]; then
    app_running_from "$app" >/dev/null && return 0
    open_app "$app" --apply-update
    return 0
  fi
  open_app "$MACAPP/next/AgentOS.app" --apply-update
}

# After an update or a link: build the app when it is out of date or missing
app_auto() {
  is_mac || return 0
  local want have ready
  want=$(app_want_hash)
  [ -n "$want" ] || return 0
  have=$(app_have_hash)
  [ "$want" = "$have" ] && return 0
  ready=$(cat "$MACAPP/next/ready" 2>/dev/null)
  if [ "$ready" = "$want" ]; then
    app_kick
    return 0
  fi
  app_stage && app_kick
}

# At each service start: an installed app that is out of date and wasn't
# tried for this version yet is built in the background (the first update
# to this version ran the old script, which knew nothing of the app)
app_catch_up() {
  is_mac || return 0
  app_path >/dev/null || return 0
  (
    want=$(app_want_hash)
    [ -n "$want" ] || exit 0
    [ "$want" = "$(app_have_hash)" ] && exit 0
    tried=$(sed -n 's/.*"hash":"\([0-9a-f]*\)".*/\1/p' "$APP_STATE" 2>/dev/null)
    if [ "$tried" = "$want" ]; then
      [ "$(cat "$MACAPP/next/ready" 2>/dev/null)" = "$want" ] && app_kick
      exit 0
    fi
    app_stage && app_kick
  ) </dev/null >/dev/null 2>&1 &
}

# Start at login (the menu's "Start at login"): once per boot
app_at_login() {
  is_mac || return 0
  [ -f "$AGENT_OS_HOME/app-at-login" ] || return 0
  local boot app
  boot=$(sysctl -n kern.boottime 2>/dev/null | sed -n 's/.*sec = \([0-9]*\).*/\1/p')
  [ -n "$boot" ] || return 0
  [ "$(cat "$AGENT_OS_HOME/.app-launched-boot" 2>/dev/null)" = "$boot" ] && return 0
  app=$(app_path) || return 0
  printf '%s\n' "$boot" >"$AGENT_OS_HOME/.app-launched-boot"
  open_app "$app" --at-login
}

cmd_app() {
  is_mac || die "The menu bar app is for macOS."
  case "${1:-update}" in
    update)
      app_stage && app_kick
      ;;
    check)
      local want have
      want=$(app_want_hash)
      have=$(app_have_hash)
      if ! app_path >/dev/null; then
        say "missing"
      elif [ -n "$want" ] && [ "$want" = "$have" ]; then
        say "current"
      else
        say "out of date"
      fi
      ;;
    install)
      [ "${2:-}" = "--from" ] && [ -n "${3:-}" ] || die "Usage: agent-os link app install --from <AgentOS.app>"
      local from="${3%/}" hash why
      case "$from" in *.app) ;; *) from="$from/AgentOS.app" ;; esac
      [ -d "$from" ] || die "There's no app at $from"
      hash=$(plist_get "$from" AgentOSSourceHash)
      case "$hash" in *[!0-9a-f]* | "") die "That app has no source hash." ;; esac
      [ "${#hash}" = 16 ] || die "That app has no source hash."
      why=$(app_verify "$from" "$hash") || die "That app was refused: $why"
      mkdir -p "$MACAPP"
      rm -rf "$MACAPP/next"
      mkdir -p "$MACAPP/next"
      ditto "$from" "$MACAPP/next/AgentOS.app" || die "Couldn't copy the app."
      "$LSREGISTER" -u "$MACAPP/next/AgentOS.app" >/dev/null 2>&1
      printf '%s\n' "$hash" >"$MACAPP/next/ready"
      app_state staged "$hash" ""
      say "Staged the app $hash."
      app_kick
      ;;
    rollback)
      local prev="$MACAPP/prev.app" hash
      [ -d "$prev" ] || die "There's no earlier app to go back to."
      hash=$(plist_get "$prev" AgentOSSourceHash)
      [ -n "$hash" ] || die "The earlier app has no source hash."
      rm -rf "$MACAPP/next"
      mkdir -p "$MACAPP/next"
      ditto "$prev" "$MACAPP/next/AgentOS.app" || die "Couldn't copy the earlier app."
      "$LSREGISTER" -u "$MACAPP/next/AgentOS.app" >/dev/null 2>&1
      printf '%s\n' "$hash" >"$MACAPP/next/ready"
      app_state staged "$hash" ""
      say "Going back to the app $hash."
      app_kick
      ;;
    auto) app_auto ;;
    *) die "Usage: agent-os link app [update|check|install --from <AgentOS.app>|rollback]" ;;
  esac
}

cmd_run() {
  [ -d "$REPO_DIR" ] || die "AgentOS isn't installed in $REPO_DIR"
  mkdir -p "$LOG_DIR"
  app_at_login
  app_catch_up
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
  if [ "$code" = 0 ]; then
    if xcrun -f swiftc >/dev/null 2>&1; then
      app_auto >/dev/null 2>&1 || true
    else
      say "Warning: the menu bar app needs Apple's developer tools. AgentOS works without it."
    fi
    say "" && say "Done. This Mac now shows in AgentOS. You can close this window."
  fi
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
  say "Removed from your server. AgentOS is still installed here; to remove it, run agent-os uninstall."
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
    # The service runs with NODE_ENV=production, where npm leaves out the
    # packages the build needs (TypeScript): ask for them
    npm install --include=dev --legacy-peer-deps >/dev/null 2>&1 || npm install --include=dev --legacy-peer-deps || { echo "install failed"; exit 1; }
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
      # The menu bar app follows, built by the new copy's script in the
      # background once this update's lock is gone
      if is_mac; then
        nohup /bin/bash "$REPO_DIR/scripts/agentos-machine.sh" app auto </dev/null >/dev/null 2>&1 &
      fi
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
  app) shift; cmd_app "$@" ;;
  *) sed -n '3,21p' "$0"; exit 1 ;;
esac
