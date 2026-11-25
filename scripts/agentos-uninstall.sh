#!/bin/bash
#
# Removes AgentOS from this Mac, a machine linked to your AgentOS server:
# the service, its data, the key that links it, the agent-os command and
# the menu bar app. Your repositories, ~/.claude and ~/.claude.json stay.
# It refuses on the server itself. Works with the bash that ships with
# macOS (3.2) and needs no node.
#
#   agent-os uninstall [--dry-run] [--yes] [--keep-sessions] [--json]
#
#   --dry-run        only list what would go and what stays
#   --yes            don't ask first
#   --keep-sessions  leave running sessions running
#   --json           print the plan (and the result) as JSON
#
# Exit codes: 0 removed, 1 refused, 2 cancelled, 3 partly removed.

set -u

# Every outside tool goes through run (a PATH lookup, never a builtin), so
# tests can put stand-ins first on PATH
run() { env "$@"; }

SESSION_RE='^(claude|codex|gemini|opencode|shell)-[0-9a-f-]{36}$'
ID_RE='^[A-Za-z0-9_-]{1,64}$'

say() { [ "$JSON" = 1 ] || printf '%s\n' "$*"; }

# A path as the person reads it: their home folder written "~"
tildify() {
  case "$1" in
    "$HOME") printf '~' ;;
    "$HOME"/*) printf '~%s' "${1#"$HOME"}" ;;
    *) printf '%s' "$1" ;;
  esac
}

# Text with control characters taken out (names come from the database)
plain() { printf '%s' "$1" | tr -d '\000-\037\177'; }

jstr() {
  local s
  s=$(plain "$1")
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  printf '"%s"' "$s"
}

# Runs a command for at most $1 seconds; prints what it printed
capped() {
  local secs=$1 out pid i=0 rc
  shift
  out=$(mktemp "$WORK/cap.XXXXXX") || return 1
  "$@" >"$out" 2>/dev/null &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$i" -ge $((secs * 5)) ]; then
      kill "$pid" 2>/dev/null
      break
    fi
    sleep 0.2
    i=$((i + 1))
  done
  wait "$pid" 2>/dev/null
  rc=$?
  cat "$out"
  rm -f "$out"
  return "$rc"
}

# The tmux sessions of AgentOS on this Mac (the default server, or a test one)
tmx() {
  if [ -n "$TMUX_SOCKET" ]; then
    run -u TMUX tmux -L "$TMUX_SOCKET" "$@"
  else
    run -u TMUX tmux "$@"
  fi
}

bundle_id() {
  local plist="$1/Contents/Info.plist"
  [ -f "$plist" ] || return 1
  if [ -x /usr/libexec/PlistBuddy ]; then
    /usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$plist" 2>/dev/null
  else
    sed -n '/<key>CFBundleIdentifier<\/key>/{n;s/.*<string>\(.*\)<\/string>.*/\1/p;}' "$plist"
  fi
}

json_field() {
  # The first "key": "value" in a small JSON file (link.json); no node
  sed -n "s/.*\"$2\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p" "$1" 2>/dev/null | head -n 1
}

message() {
  case "$1" in
    hub) printf '%s' "This is the AgentOS your Macs link to, not a linked Mac. agent-os uninstall only removes AgentOS from a linked Mac. Nothing was removed." ;;
    root) printf '%s' "Run this as yourself, not with sudo. Nothing was removed." ;;
    notInstalled) printf '%s' "AgentOS isn't installed on this Mac." ;;
    inSession) printf '%s' "Run this in Terminal, not in an AgentOS session. Nothing was removed." ;;
    home) printf '%s' "This Terminal's home folder isn't your account's home folder. Nothing was removed." ;;
  esac
}

refuse() {
  if [ "$JSON" = 1 ]; then
    printf '{"refused":"%s","message":%s}\n' "$1" "$(jstr "$(message "$1")")"
  else
    message "$1" >&2
    printf '\n' >&2
  fi
  exit 1
}

# AGENT_OS_HOME, written as given, must be ~/.agent-os: its folder is the
# home folder and its name is .agent-os. AH is where it really is.
home_ok() {
  local given="$1" parent real_home
  while [ "${given%/}" != "$given" ] && [ "$given" != / ]; do given="${given%/}"; done
  [ "$(basename "$given")" = ".agent-os" ] || return 1
  parent=$(cd -P "$(dirname "$given")" 2>/dev/null && pwd) || return 1
  real_home=$(cd -P "$HOME" 2>/dev/null && pwd) || return 1
  [ "$parent" = "$real_home" ] || return 1
  AH_LINK="$HOME/.agent-os"
  AH=$(cd -P "$AH_LINK" 2>/dev/null && pwd) || return 1
  [ -f "$AH/.installed-node" ] || [ -f "$AH/link.json" ]
}

is_hub() {
  [ -e "$ROOT/.dockerenv" ] && return 0
  case "${AGENT_OS_HOME%/}" in /config/.agent-os) return 0 ;; esac
  local dir="${AGENT_OS_HOME%/}"
  [ -e "$dir/link-hub.json" ] && return 0
  if [ -e "$dir/agent-os.db" ]; then
    local count
    count=$(run sqlite3 "$dir/agent-os.db" "select count(*) from machines" 2>/dev/null) || return 0
    case "$count" in "" | *[!0-9]*) return 0 ;; esac
    [ "$count" -gt 0 ] && return 0
    [ -e "$dir/link.json" ] || return 0
  fi
  return 1
}

# ---------------------------------------------------------------- the plan

plan_sessions() {
  local rows line id tmux name dir agent
  [ -f "$AH/agent-os.db" ] || return 0
  local clean="replace(replace(replace(replace(coalesce(name,''),char(9),' '),char(10),' '),char(13),' '),char(31),' ')"
  # A separator that isn't white space: an empty name stays an empty field
  local sep=$'\037'
  rows=$(run sqlite3 -separator "$sep" "$AH/agent-os.db" \
    "select id, coalesce(tmux_name, agent_type||'-'||id), $clean, coalesce(worktree_path, working_directory, '') from sessions" 2>/dev/null) ||
    rows=$(run sqlite3 -separator "$sep" "$AH/agent-os.db" \
      "select id, coalesce(tmux_name, agent_type||'-'||id), $clean, '' from sessions" 2>/dev/null) || {
      WARN+=("Couldn't read the list of sessions")
      return 0
    }
  while IFS="$sep" read -r id tmux name dir; do
    [ -n "$id" ] || continue
    [[ "$id" =~ $ID_RE ]] || continue
    # The tmux name must be "<agent>-<this row's id>", nothing else
    agent="${tmux%%-*}"
    case "$agent" in claude | codex | gemini | opencode | shell) ;; *) continue ;; esac
    [ "$tmux" = "$agent-$id" ] || continue
    tmx has-session -t "=$tmux" >/dev/null 2>&1 || continue
    S_ID+=("$id")
    S_TMUX+=("$tmux")
    S_NAME+=("${name:-$tmux}")
    S_DIR+=("$dir")
  done <<EOF
$rows
EOF
}

# Where kept worktrees go: the repositories folder, if it is under the home
# folder and outside ~/.agent-os, else ~/AgentOS
plan_kept_folder() {
  local value="" base inside=""
  if [ -f "$AH/agent-os.db" ]; then
    value=$(run sqlite3 "$AH/agent-os.db" "select value from preferences where key='repos_dir'" 2>/dev/null | head -n 1)
  fi
  value="${value#\"}"
  value="${value%\"}"
  case "$value" in
    "~") value="$HOME" ;;
    "~/"*) value="$HOME/${value#\~/}" ;;
    /*) ;;
    *) value="" ;;
  esac
  case "$value" in *..*) value="" ;; esac
  base=""
  if [ -n "$value" ]; then
    if [ -d "$value" ]; then
      base=$(cd -P "$value" 2>/dev/null && pwd) || base=""
    else
      base="$value"
    fi
  fi
  local real_home
  real_home=$(cd -P "$HOME" && pwd)
  case "$base" in
    "$real_home"/* | "$HOME"/*)
      case "$base/" in
        "$AH"/* | "$AH_LINK"/*)
          # Repositories inside ~/.agent-os would go with it: it stays
          INSIDE+=("your repositories folder ($(tildify "$base")) is in it")
          inside="$base"
          base=""
          ;;
      esac
      ;;
    *) base="" ;;
  esac
  [ -n "$base" ] || base="$HOME/AgentOS"
  REPOS="${inside:-$base}"
  KEPT="$base/Kept from AgentOS"
}

# A new folder name under KEPT: "<name>", "<name> 2", "<name> 3" …
kept_target() {
  local name="$1" n=1 candidate taken t
  while :; do
    if [ "$n" = 1 ]; then candidate="$KEPT/$name"; else candidate="$KEPT/$name $n"; fi
    taken=0
    [ -e "$candidate" ] || [ -L "$candidate" ] && taken=1
    for t in ${W_TO[@]+"${W_TO[@]}"}; do [ "$t" = "$candidate" ] && taken=1; done
    [ "$taken" = 0 ] && break
    n=$((n + 1))
  done
  printf '%s' "$candidate"
}

plan_worktrees() {
  local wt name status ahead subs main common changed why
  [ -d "$AH/worktrees" ] || return 0
  for wt in "$AH/worktrees"/* "$AH/worktrees"/.[!.]*; do
    [ -e "$wt" ] || [ -L "$wt" ] || continue
    name=$(basename "$wt")
    if [ -L "$wt" ]; then
      W_PATH+=("$wt"); W_NAME+=("$name"); W_KIND+=("link"); W_WHY+=(""); W_TO+=(""); W_MAIN+=("")
      continue
    fi
    main=""
    common=$(run git -C "$wt" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || common=""
    case "$common" in */.git) main="${common%/.git}" ;; esac
    [ -n "$main" ] && [ -d "$main" ] || main=""
    why=""
    if ! status=$(run git --no-optional-locks -C "$wt" status --porcelain --ignored 2>/dev/null); then
      why="couldn't read it with git"
    elif ! ahead=$(run git -C "$wt" rev-list HEAD --not --remotes --count 2>/dev/null); then
      why="couldn't read it with git"
    elif ! subs=$(run git --no-optional-locks -C "$wt" submodule status --recursive 2>/dev/null); then
      why="couldn't read it with git"
    else
      changed=0
      [ -n "$status" ] && changed=$(printf '%s\n' "$status" | grep -c .)
      [ "$changed" = 1 ] && why="1 changed file"
      [ "$changed" -gt 1 ] 2>/dev/null && why="$changed changed files"
      if [ "${ahead:-0}" != 0 ]; then
        [ -n "$why" ] && why="$why, "
        if [ "$ahead" = 1 ]; then why="${why}1 commit not pushed"; else why="${why}$ahead commits not pushed"; fi
      fi
      if printf '%s\n' "$subs" | grep -q '^[-+U]'; then
        [ -n "$why" ] && why="$why, "
        why="${why}a submodule isn't saved"
      fi
    fi
    W_PATH+=("$wt"); W_NAME+=("$name"); W_MAIN+=("$main")
    if [ -n "$why" ] || [ -z "$main" ]; then
      # A kept worktree's commits live in its repository: one inside
      # ~/.agent-os would go with it, so ~/.agent-os stays
      case "$main/" in "$AH"/* | "$AH_LINK"/*) INSIDE+=("the repository of the worktree $(plain "$name") is in it") ;; esac
    fi
    if [ -z "$why" ] && [ -n "$main" ]; then
      W_KIND+=("clean"); W_WHY+=(""); W_TO+=("")
    else
      [ -n "$why" ] || why="its repository is gone"
      W_KIND+=("keep"); W_WHY+=("$why"); W_TO+=("$(kept_target "$name")")
    fi
  done
}

# AgentOS's tool entry in Codex and Gemini, when it is this install's
plan_tools() {
  local tool out
  for tool in codex gemini; do
    command -v "$tool" >/dev/null 2>&1 || continue
    out=$(capped 10 run "$tool" mcp list) || true
    if printf '%s\n' "$out" | grep 'agent-os' | grep -qF "$AH_LINK/repo/scripts/agent-os"; then
      TOOLS+=("$tool")
    elif printf '%s\n' "$out" | grep 'agent-os' | grep -qF "$AH/repo/scripts/agent-os"; then
      TOOLS+=("$tool")
    fi
  done
}

plan_apps() {
  local app
  for app in "$APPS_ROOT/Applications/AgentOS.app" "$HOME/Applications/AgentOS.app"; do
    [ -d "$app" ] || continue
    [ "$(bundle_id "$app")" = com.agentos.mac ] && APPS+=("$app")
  done
}

plan_command() {
  local cmd="$HOME/.local/bin/agent-os" target
  [ -L "$cmd" ] || return 0
  target=$(readlink "$cmd")
  case "$target" in "$AH_LINK"/* | "$AH"/*) COMMAND="$cmd" ;; esac
}

# ---------------------------------------------------------------- output

print_plan() {
  local machine hub size i any
  machine=$(json_field "$AH/link.json" name)
  [ -n "$machine" ] || machine=$(hostname 2>/dev/null)
  hub=$(json_field "$AH/link.json" hubUrl)
  hub="${hub#*://}"
  hub="${hub%%/*}"
  [ -n "$hub" ] || hub="your server"
  size=$(capped 5 run du -sh "$AH/repo" | awk '{print $1}') || size=""
  MACHINE="$machine"
  HUB="$hub"
  REPO_SIZE="$size"

  if [ "$JSON" = 1 ]; then return 0; fi
  say "AgentOS will be removed from this Mac ($(plain "$machine"))."
  say ""
  say "These go:"
  if [ -n "$size" ]; then
    say "  • AgentOS and its updates ($(tildify "$AH_LINK")/repo, $size)"
  else
    say "  • AgentOS and its updates ($(tildify "$AH_LINK")/repo)"
  fi
  say "  • Its list of sessions, settings, logs, saved checkpoints and handoffs ($(tildify "$AH_LINK"))"
  say "  • The key that links this Mac to $(plain "$hub") (in your Keychain)"
  say "  • Starting AgentOS at login"
  [ -n "$COMMAND" ] && say "  • The agent-os command ($(tildify "$COMMAND"))"
  for i in ${APPS[@]+"${APPS[@]}"}; do say "  • The menu bar app ($(tildify "$i")) and its window settings"; done
  [ ${#TOOLS[@]} -gt 0 ] && say "  • AgentOS's tools in Codex and Gemini"

  if [ ${#S_ID[@]} -gt 0 ]; then
    say ""
    if [ "$KEEP_SESSIONS" = 1 ]; then
      say "Running sessions, left running:"
    else
      say "Running sessions, stopped (their conversations stay in Claude):"
    fi
    for ((i = 0; i < ${#S_ID[@]}; i++)); do say "  • $(plain "${S_NAME[$i]}")"; done
  fi

  any=0
  for ((i = 0; i < ${#W_PATH[@]}; i++)); do [ "${W_KIND[$i]}" = keep ] && any=1; done
  if [ "$any" = 1 ]; then
    say ""
    say "Worktrees with work not yet pushed, kept in $(tildify "$KEPT"):"
    for ((i = 0; i < ${#W_PATH[@]}; i++)); do
      [ "${W_KIND[$i]}" = keep ] && say "  • $(plain "${W_NAME[$i]}") (${W_WHY[$i]})"
    done
  fi
  any=0
  for ((i = 0; i < ${#W_PATH[@]}; i++)); do [ "${W_KIND[$i]}" = keep ] || any=1; done
  if [ "$any" = 1 ]; then
    say ""
    say "Worktrees with nothing unsaved, removed (their branches stay in the repository):"
    for ((i = 0; i < ${#W_PATH[@]}; i++)); do
      [ "${W_KIND[$i]}" = keep ] || say "  • $(plain "${W_NAME[$i]}")"
    done
  fi
  [ "$MOVING_WARNING" = 1 ] && { say ""; say "Sessions kept running in a worktree that moves will lose their folder."; }

  say ""
  say "These stay:"
  say "  • Your repositories ($(tildify "$REPOS")) and everything in them"
  say "  • Claude's conversations and settings (~/.claude and ~/.claude.json)"
  say "  • Homebrew, Node and tmux"
  say "  • This app's entry in System Settings, Notifications"
  say ""
  say "Your server still lists this Mac. Remove it there afterwards: AgentOS on your phone, Settings, Machines."
  for i in ${WARN[@]+"${WARN[@]}"}; do say ""; say "Note: $i"; done
}

print_json() {
  local i sep out
  out='{"refused":null'
  out="$out,\"machine\":$(jstr "$MACHINE"),\"hub\":$(jstr "$HUB")"
  out="$out,\"goes\":["
  if [ -n "$REPO_SIZE" ]; then
    out="$out{\"what\":\"AgentOS and its updates\",\"path\":$(jstr "$AH_LINK/repo"),\"size\":$(jstr "$REPO_SIZE")}"
  else
    out="$out{\"what\":\"AgentOS and its updates\",\"path\":$(jstr "$AH_LINK/repo")}"
  fi
  out="$out,{\"what\":\"Its list of sessions, settings, logs, saved checkpoints and handoffs\",\"path\":$(jstr "$AH_LINK")}"
  out="$out,{\"what\":$(jstr "The key that links this Mac to $HUB"),\"path\":\"Keychain\"}"
  out="$out,{\"what\":\"Starting AgentOS at login\",\"path\":$(jstr "$HOME/Library/LaunchAgents/com.agentos.machine.plist")}"
  [ -n "$COMMAND" ] && out="$out,{\"what\":\"The agent-os command\",\"path\":$(jstr "$COMMAND")}"
  for i in ${APPS[@]+"${APPS[@]}"}; do out="$out,{\"what\":\"The menu bar app and its window settings\",\"path\":$(jstr "$i")}"; done
  for i in ${TOOLS[@]+"${TOOLS[@]}"}; do out="$out,{\"what\":\"AgentOS's tools in $i\",\"path\":\"$i\"}"; done
  out="$out],\"stays\":["
  out="$out{\"what\":\"Your repositories and everything in them\",\"path\":$(jstr "$REPOS")}"
  out="$out,{\"what\":\"Claude's conversations and settings\",\"path\":$(jstr "$HOME/.claude")}"
  out="$out,{\"what\":\"Claude's settings file\",\"path\":$(jstr "$HOME/.claude.json")}"
  out="$out,{\"what\":\"Homebrew, Node and tmux\",\"path\":\"\"}"
  out="$out,{\"what\":\"This app's entry in System Settings, Notifications\",\"path\":\"\"}"
  out="$out],\"sessions\":["
  sep=""
  for ((i = 0; i < ${#S_ID[@]}; i++)); do
    if [ "$KEEP_SESSIONS" = 1 ]; then stop=false; else stop=true; fi
    out="$out$sep{\"id\":$(jstr "${S_ID[$i]}"),\"name\":$(jstr "${S_NAME[$i]}"),\"tmux\":$(jstr "${S_TMUX[$i]}"),\"stop\":$stop}"
    sep=","
  done
  out="$out],\"worktrees\":["
  sep=""
  for ((i = 0; i < ${#W_PATH[@]}; i++)); do
    if [ "${W_KIND[$i]}" = keep ]; then
      out="$out$sep{\"name\":$(jstr "${W_NAME[$i]}"),\"path\":$(jstr "${W_PATH[$i]}"),\"keep\":true,\"why\":$(jstr "${W_WHY[$i]}"),\"to\":$(jstr "${W_TO[$i]}")}"
    else
      out="$out$sep{\"name\":$(jstr "${W_NAME[$i]}"),\"path\":$(jstr "${W_PATH[$i]}"),\"keep\":false,\"why\":null,\"to\":null}"
    fi
    sep=","
  done
  out="$out],\"kept\":$(jstr "$KEPT"),\"repos\":$(jstr "$REPOS")"
  out="$out,\"warnings\":["
  sep=""
  for i in ${WARN[@]+"${WARN[@]}"}; do out="$out$sep$(jstr "$i")"; sep=","; done
  [ "$MOVING_WARNING" = 1 ] && out="$out$sep\"Sessions kept running in a worktree that moves will lose their folder.\""
  out="$out],\"done\":"
  if [ -n "$1" ]; then
    out="$out{\"stopped\":$STOPPED,\"kept\":$KEPT_N,\"removed\":["
    sep=""
    for i in ${REMOVED[@]+"${REMOVED[@]}"}; do out="$out$sep$(jstr "$i")"; sep=","; done
    out="$out],\"left\":["
    sep=""
    for ((i = 0; i < ${#LEFT_PATH[@]}; i++)); do
      out="$out$sep{\"path\":$(jstr "${LEFT_PATH[$i]}"),\"reason\":$(jstr "${LEFT_WHY[$i]}")}"
      sep=","
    done
    out="$out]}"
  else
    out="${out}null"
  fi
  printf '%s}\n' "$out"
}

left() { LEFT_PATH+=("$1"); LEFT_WHY+=("$2"); }

# ---------------------------------------------------------------- the steps

stop_service() {
  local label plist pid comm
  if [ "$OS" = Darwin ]; then
    for label in "$LABEL" "$OLD_LABEL"; do
      run launchctl bootout "gui/$(id -u)/$label" >/dev/null 2>&1 || true
      plist="$HOME/Library/LaunchAgents/$label.plist"
      if [ -e "$plist" ]; then
        rm -f -- "$plist" && REMOVED+=("$plist") || left "$plist" "couldn't remove it"
      fi
    done
  else
    if command -v systemctl >/dev/null 2>&1; then
      run systemctl --user disable --now agent-os.service >/dev/null 2>&1 || true
    fi
    plist="$HOME/.config/systemd/user/agent-os.service"
    if [ -e "$plist" ]; then rm -f -- "$plist" && REMOVED+=("$plist") || left "$plist" "couldn't remove it"; fi
  fi
  pid=$(cat "$AH/agent-os.pid" 2>/dev/null | tr -cd '0-9')
  if [ -n "$pid" ]; then
    comm=$(run ps -o comm= -p "$pid" 2>/dev/null)
    case "$(basename "${comm:-x}")" in node | tsx) run kill "$pid" >/dev/null 2>&1 || true ;; esac
  fi
}

stop_sessions() {
  local i
  [ "$KEEP_SESSIONS" = 1 ] && return 0
  for ((i = 0; i < ${#S_ID[@]}; i++)); do
    if tmx kill-session -t "=${S_TMUX[$i]}" >/dev/null 2>&1; then
      STOPPED=$((STOPPED + 1))
    fi
  done
}

forget_key() {
  local n=0
  if [ "$OS" = Darwin ]; then
    while [ "$n" -lt 20 ] && run security delete-generic-password -s "$KEYCHAIN" >/dev/null 2>&1; do
      n=$((n + 1))
    done
  fi
  rm -f -- "$AH/link.key"
}

handle_worktrees() {
  local i wt main to real_kept
  for ((i = 0; i < ${#W_PATH[@]}; i++)); do
    wt="${W_PATH[$i]}"
    main="${W_MAIN[$i]}"
    case "${W_KIND[$i]}" in
      link)
        unlink "$wt" 2>/dev/null || left "$wt" "couldn't remove the link"
        ;;
      clean)
        run git -C "$main" worktree remove "$wt" >/dev/null 2>&1 || left "$wt" "git couldn't remove the worktree"
        ;;
      keep)
        to="${W_TO[$i]}"
        mkdir -p "$KEPT" 2>/dev/null
        real_kept=$(cd -P "$KEPT" 2>/dev/null && pwd) || real_kept=""
        case "$real_kept/" in
          / | "$AH"/* | "$AH_LINK"/*)
            left "$wt" "couldn't move it to $(tildify "$to")"
            continue
            ;;
        esac
        if [ -e "$to" ] || [ -L "$to" ]; then
          left "$wt" "$(tildify "$to") is already there"
          continue
        fi
        if [ -n "$main" ] && run git -C "$main" worktree move "$wt" "$to" >/dev/null 2>&1; then
          KEPT_N=$((KEPT_N + 1))
        elif mv -n "$wt" "$to" 2>/dev/null && [ -e "$to" ] && [ ! -e "$wt" ]; then
          run git -C "$to" worktree repair >/dev/null 2>&1 || true
          KEPT_N=$((KEPT_N + 1))
        else
          left "$wt" "couldn't move it to $(tildify "$to")"
        fi
        ;;
    esac
  done
}

remove_tools() {
  local tool
  for tool in ${TOOLS[@]+"${TOOLS[@]}"}; do
    capped 20 run "$tool" mcp remove agent-os >/dev/null || left "$tool" "couldn't remove AgentOS's tools from it"
  done
}

remove_apps() {
  local app exe pid comm i
  for app in ${APPS[@]+"${APPS[@]}"}; do
    exe="$app/Contents/MacOS/AgentOS"
    [ -x "$exe" ] && capped 5 "$exe" --command quit >/dev/null
    for pid in $(run pgrep -x AgentOS 2>/dev/null); do
      comm=$(run ps -o comm= -p "$pid" 2>/dev/null)
      [ "$comm" = "$exe" ] && run kill "$pid" >/dev/null 2>&1
    done
    i=0
    while [ "$i" -lt 25 ]; do
      still=0
      for pid in $(run pgrep -x AgentOS 2>/dev/null); do
        [ "$(run ps -o comm= -p "$pid" 2>/dev/null)" = "$exe" ] && still=1
      done
      [ "$still" = 0 ] && break
      sleep 0.2
      i=$((i + 1))
    done
    [ -x "$LSREGISTER" ] && run "$LSREGISTER" -u "$app" >/dev/null 2>&1
    case "$app" in
      "$APPS_ROOT/Applications/AgentOS.app" | "$HOME/Applications/AgentOS.app") ;;
      *) continue ;;
    esac
    if [ "$(bundle_id "$app")" = com.agentos.mac ]; then
      rm -rf -- "$app" && REMOVED+=("$app") || left "$app" "couldn't remove it"
    fi
  done
}

remove_app_data() {
  local d
  [ "$OS" = Darwin ] || return 0
  run defaults delete "$DEFAULTS_DOMAIN" >/dev/null 2>&1 || true
  # What the person allowed AgentOS in Privacy & Security goes with it
  run tccutil reset All com.agentos.host >/dev/null 2>&1 || true
  for d in "Library/WebKit/com.agentos.mac" "Library/Caches/com.agentos.mac" \
    "Library/HTTPStorages/com.agentos.mac" "Library/Saved Application State/com.agentos.mac.savedState"; do
    [ -e "$HOME/$d" ] || continue
    rm -rf -- "${HOME:?}/$d" && REMOVED+=("$HOME/$d") || left "$HOME/$d" "couldn't remove it"
  done
}

remove_command() {
  [ -n "$COMMAND" ] || return 0
  rm -f -- "$COMMAND" && REMOVED+=("$COMMAND") || left "$COMMAND" "couldn't remove it"
}

remove_home() {
  home_ok "$AGENT_OS_HOME" || { left "$AH_LINK" "it no longer looks like AgentOS's folder"; return; }
  if [ ${#INSIDE[@]} -gt 0 ]; then
    left "$AH_LINK" "${INSIDE[0]}"
    return
  fi
  if [ -d "$AH/worktrees" ] && [ -n "$(ls -A "$AH/worktrees" 2>/dev/null)" ]; then
    left "$AH_LINK" "worktrees are still in it"
    return
  fi
  if [ -L "$AH_LINK" ]; then
    rm -- "$AH_LINK" && REMOVED+=("$AH_LINK") || left "$AH_LINK" "couldn't remove the link"
  else
    rm -rf -- "$AH_LINK"
    if [ -e "$AH_LINK" ]; then left "$AH_LINK" "couldn't remove everything in it"; else REMOVED+=("$AH_LINK"); fi
  fi
}

# ---------------------------------------------------------------- main

main() {
  # It deletes its own folder: run from a copy. Only that copy, in the
  # folder made for it here, removes its folder when it ends; a --reexec
  # typed by hand runs from a fresh copy like any other run.
  local here copy
  here=$(cd -P "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd) || here=""
  if [ "${1:-}" != "--reexec" ] || [ -z "${AGENTOS_UNINSTALL_COPY:-}" ] ||
    [ "$AGENTOS_UNINSTALL_COPY" != "$here" ]; then
    copy=$(mktemp -d "${TMPDIR:-/tmp}/agentos-uninstall.XXXXXX") || exit 1
    copy=$(cd -P "$copy" && pwd) || exit 1
    cp "${BASH_SOURCE[0]}" "$copy/agentos-uninstall.sh" || exit 1
    AGENTOS_UNINSTALL_COPY="$copy" exec /bin/bash "$copy/agentos-uninstall.sh" --reexec "$@"
  fi
  shift
  unset AGENTOS_UNINSTALL_COPY
  WORK="$here"
  trap 'rm -rf "$WORK"' EXIT

  DRY=0 YES=0 KEEP_SESSIONS=0 JSON=0 FROM_APP=0
  for arg in "$@"; do
    case "$arg" in
      --dry-run) DRY=1 ;;
      --yes) YES=1 ;;
      --keep-sessions) KEEP_SESSIONS=1 ;;
      --json) JSON=1 ;;
      --from-app) FROM_APP=1 ;;
      -h | --help) sed -n '3,16p' "${BASH_SOURCE[0]}"; exit 0 ;;
      *) printf '%s\n' "agent-os uninstall: unknown option $arg" >&2; exit 64 ;;
    esac
  done

  TEST=0
  [ "${AGENTOS_UNINSTALL_TEST:-}" = 1 ] && TEST=1
  if [ "$TEST" = 1 ]; then
    # Tests never reach the real service, Keychain item, app or settings
    ROOT="${AGENTOS_UNINSTALL_ROOT:-$HOME/.agentos-test-root}"
    APPS_ROOT="$ROOT"
    OS="${AGENTOS_UNINSTALL_OS:-$(uname -s)}"
    TMUX_SOCKET="${AGENTOS_TMUX_SOCKET:-}"
    LABEL=com.agentos.machine.test
    OLD_LABEL=com.agent-os.test
    KEYCHAIN=agentos-link-test
    DEFAULTS_DOMAIN=com.agentos.mac.test
  else
    ROOT=""
    APPS_ROOT=""
    OS=$(uname -s)
    TMUX_SOCKET=""
    LABEL=com.agentos.machine
    OLD_LABEL=com.agent-os
    KEYCHAIN=agentos-link
    DEFAULTS_DOMAIN=com.agentos.mac
  fi
  LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
  AGENT_OS_HOME="${AGENT_OS_HOME:-$HOME/.agent-os}"

  # --- Pre-checks: refuse before anything else happens
  [ "$(id -u)" = 0 ] && refuse root
  is_hub && refuse hub
  if [ "$TEST" = 0 ]; then
    local want=""
    if [ "$OS" = Darwin ]; then
      want=$(run dscl . -read "/Users/$(id -un)" NFSHomeDirectory 2>/dev/null | sed -n 's/^NFSHomeDirectory: //p')
    else
      want=$(getent passwd "$(id -un)" 2>/dev/null | cut -d: -f6)
    fi
    [ -n "$want" ] && [ "$want" = "${HOME%/}" ] || refuse home
  fi
  case "$HOME" in "" | / | //*) refuse home ;; esac
  home_ok "$AGENT_OS_HOME" || refuse notInstalled
  if [ "$FROM_APP" = 0 ] && [ -n "${TMUX:-}" ]; then
    local here
    here=$(run tmux display -p '#S' 2>/dev/null)
    [[ "$here" =~ $SESSION_RE ]] && refuse inSession
  fi

  # --- The plan (probes only)
  S_ID=() S_TMUX=() S_NAME=() S_DIR=()
  W_PATH=() W_NAME=() W_KIND=() W_WHY=() W_TO=() W_MAIN=()
  TOOLS=() APPS=() WARN=() REMOVED=() LEFT_PATH=() LEFT_WHY=() INSIDE=()
  COMMAND="" STOPPED=0 KEPT_N=0 MOVING_WARNING=0
  plan_sessions
  plan_kept_folder
  plan_worktrees
  plan_tools
  plan_apps
  plan_command
  local w
  for w in ${INSIDE[@]+"${INSIDE[@]}"}; do WARN+=("$(tildify "$AH_LINK") stays: $w"); done
  if [ "$KEEP_SESSIONS" = 1 ]; then
    local i j
    for ((i = 0; i < ${#S_ID[@]}; i++)); do
      for ((j = 0; j < ${#W_PATH[@]}; j++)); do
        [ "${W_KIND[$j]}" = keep ] || continue
        case "${S_DIR[$i]}/" in "${W_PATH[$j]}"/*) MOVING_WARNING=1 ;; esac
      done
    done
  fi
  print_plan

  if [ "$DRY" = 1 ]; then
    [ "$JSON" = 1 ] && print_json ""
    exit 0
  fi

  # --- 1. Confirm
  if [ "$YES" = 0 ]; then
    if [ "$JSON" = 0 ] && [ -t 0 ]; then
      say ""
      printf '%s ' "Type yes to remove AgentOS from this Mac:"
      local answer=""
      read -r answer
      if [ "$answer" != yes ]; then
        say "Nothing was removed."
        exit 2
      fi
    else
      printf '%s\n' "Nothing was removed. To remove without being asked, run: agent-os uninstall --yes" >&2
      exit 2
    fi
  fi

  # --- 2 to 10
  stop_service
  stop_sessions
  forget_key
  handle_worktrees
  remove_tools
  if [ "$FROM_APP" = 0 ]; then
    remove_apps
    remove_app_data
  fi
  remove_command
  remove_home

  if [ "$JSON" = 1 ]; then
    print_json done
  elif [ ${#LEFT_PATH[@]} -eq 0 ]; then
    say ""
    [ "$STOPPED" -gt 0 ] && say "Stopped $STOPPED session(s)."
    [ "$KEPT_N" -gt 0 ] && say "Kept $KEPT_N worktree(s) in $(tildify "$KEPT")."
    say "AgentOS was removed from this Mac. Your repositories and ~/.claude are untouched."
    say "Remove this Mac on your phone too: AgentOS, Settings, Machines."
  else
    say ""
    say "AgentOS was only partly removed. Still here:"
    local k
    for ((k = 0; k < ${#LEFT_PATH[@]}; k++)); do say "  • $(tildify "${LEFT_PATH[$k]}"): ${LEFT_WHY[$k]}"; done
    say "Run agent-os uninstall again, or open the AgentOS menu and choose Uninstall AgentOS…"
  fi
  [ ${#LEFT_PATH[@]} -eq 0 ] && exit 0
  exit 3
}

main "$@"
