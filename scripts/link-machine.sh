#!/bin/bash
#
# Links this Mac to your AgentOS, so sessions can run here and you can open
# them from your phone. AgentOS gives you the full command (Settings,
# Machines, Add a Mac):
#
#   curl -fsSL https://raw.githubusercontent.com/elabx-org/agent-os/main/scripts/link-machine.sh | bash -s -- <invite>
#
# It installs AgentOS under ~/.agent-os, signs you in, and starts it at
# login. Nothing is opened to the network: this Mac only dials out.
# To undo:  agent-os uninstall

set -u

INVITE="${1:-}"
AGENT_OS_HOME="${AGENT_OS_HOME:-$HOME/.agent-os}"
REPO_URL="https://github.com/elabx-org/agent-os.git"
REPO_DIR="$AGENT_OS_HOME/repo"

say() { printf '%s\n' "$*"; }
step() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n%s\n' "$*" >&2; exit 1; }

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

# Everything runs inside main, called on the last line: the script arrives
# on stdin (curl | bash), and a command that reads stdin (Homebrew does)
# would otherwise swallow the rest of it and the install would just stop.
main() {
  [ -n "$INVITE" ] || die "Copy the whole command from AgentOS: Settings, Machines, Add a Mac."
  [ "$(uname -s)" = Darwin ] || die "This installer is for macOS."

  for dir in "$HOME/.local/bin" /opt/homebrew/bin /usr/local/bin; do
    case ":$PATH:" in *":$dir:"*) ;; *) [ -d "$dir" ] && PATH="$dir:$PATH" ;; esac
  done
  export PATH

  step "1 of 5  Checking this Mac"
  xcode-select -p >/dev/null 2>&1 || {
    xcode-select --install >/dev/null 2>&1
    die "Apple's developer tools are needed. A window has opened to install them; when it finishes, paste the command again."
  }
  need=""
  node_ok || use_node22 || need="$need node@22"
  command -v tmux >/dev/null 2>&1 || need="$need tmux"
  if [ -n "$need" ]; then
    command -v brew >/dev/null 2>&1 || die "Missing:$need. Install Homebrew from https://brew.sh, then paste the command again."
    say "Installing$need with Homebrew"
    # shellcheck disable=SC2086
    brew install $need </dev/null || die "Homebrew couldn't install:$need"
  fi
  node_ok || use_node22 || die "Node 20 to 24 is needed (this Mac has $(node -v 2>/dev/null || echo none)). Run: brew install node@22"
  command -v claude >/dev/null 2>&1 || say "Note: the Claude CLI isn't installed yet. Sessions need it: https://claude.com/claude-code"

  # The version your AgentOS runs, from the invite (no secrets are read here)
  sha=$(printf '%s' "$INVITE" | node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try { const v = JSON.parse(Buffer.from(s, "base64url").toString()).sha; process.stdout.write(/^[0-9a-f]{40}$/.test(v) ? v : ""); } catch {}
    })')

  step "2 of 5  Downloading AgentOS"
  mkdir -p "$AGENT_OS_HOME"
  if [ -d "$REPO_DIR/.git" ]; then
    (cd "$REPO_DIR" && git fetch -q origin) || die "Couldn't update the copy in $REPO_DIR"
  else
    git clone -q "$REPO_URL" "$REPO_DIR" || die "Couldn't download AgentOS"
  fi
  cd "$REPO_DIR" || exit 1
  if [ -n "$sha" ]; then
    git checkout -q "$sha" || die "Couldn't find your AgentOS's version on GitHub"
  else
    git checkout -q origin/main
  fi

  step "3 of 5  Building (a few minutes)"
  # Modules left by an install that failed, or built for another Node, go
  built_with="$AGENT_OS_HOME/.installed-node"
  [ "$(cat "$built_with" 2>/dev/null)" = "$(node -v)" ] || rm -rf node_modules
  rm -f "$built_with"
  npm install --legacy-peer-deps >"$AGENT_OS_HOME/install.log" 2>&1 || die "Install failed. Details: $AGENT_OS_HOME/install.log"
  NODE_ENV=production npm run build >>"$AGENT_OS_HOME/install.log" 2>&1 || die "Build failed. Details: $AGENT_OS_HOME/install.log"
  node -v >"$built_with"
  mkdir -p "$HOME/.local/bin"
  ln -sf "$REPO_DIR/scripts/agent-os" "$HOME/.local/bin/agent-os"

  step "4 of 5  Adding AgentOS to the menu bar"
  # The app starts with the Mac (its menu's "Start at login"), unless the
  # person has set that option in the menu: app-at-login-set records it,
  # so running this again never turns it back on
  [ -e "$AGENT_OS_HOME/app-at-login-set" ] || touch "$AGENT_OS_HOME/app-at-login"
  if ! /bin/bash "$REPO_DIR/scripts/agentos-machine.sh" app update; then
    say "The menu bar app didn't build; AgentOS works without it. Try again later with: agent-os link app"
  fi

  step "5 of 5  Linking"
  exec /bin/bash "$REPO_DIR/scripts/agentos-machine.sh" link "$INVITE"
}

main </dev/null
