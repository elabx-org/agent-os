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
# To undo:  ~/.agent-os/repo/scripts/agent-os link remove

set -u

INVITE="${1:-}"
AGENT_OS_HOME="${AGENT_OS_HOME:-$HOME/.agent-os}"
REPO_URL="https://github.com/elabx-org/agent-os.git"
REPO_DIR="$AGENT_OS_HOME/repo"

say() { printf '%s\n' "$*"; }
step() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n%s\n' "$*" >&2; exit 1; }

[ -n "$INVITE" ] || die "Copy the whole command from AgentOS: Settings, Machines, Add a Mac."
[ "$(uname -s)" = Darwin ] || die "This installer is for macOS."

for dir in "$HOME/.local/bin" /opt/homebrew/bin /usr/local/bin; do
  case ":$PATH:" in *":$dir:"*) ;; *) [ -d "$dir" ] && PATH="$dir:$PATH" ;; esac
done
export PATH

step "1 of 4  Checking this Mac"
xcode-select -p >/dev/null 2>&1 || {
  xcode-select --install >/dev/null 2>&1
  die "Apple's developer tools are needed. A window has opened to install them; when it finishes, paste the command again."
}
need=""
command -v node >/dev/null 2>&1 || need="$need node"
command -v tmux >/dev/null 2>&1 || need="$need tmux"
if [ -n "$need" ]; then
  command -v brew >/dev/null 2>&1 || die "Missing:$need. Install Homebrew from https://brew.sh, then paste the command again."
  say "Installing$need with Homebrew"
  # shellcheck disable=SC2086
  brew install $need || die "Homebrew couldn't install:$need"
fi
major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
[ "$major" -ge 20 ] || die "Node 20 or newer is needed (this Mac has $(node -v 2>/dev/null)). Run: brew upgrade node"
command -v claude >/dev/null 2>&1 || say "Note: the Claude CLI isn't installed yet. Sessions need it: https://claude.com/claude-code"

# The version your AgentOS runs, from the invite (no secrets are read here)
sha=$(printf '%s' "$INVITE" | node -e '
  let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
    try { const v = JSON.parse(Buffer.from(s, "base64url").toString()).sha; process.stdout.write(/^[0-9a-f]{40}$/.test(v) ? v : ""); } catch {}
  })')

step "2 of 4  Downloading AgentOS"
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

step "3 of 4  Building (a few minutes)"
npm install --legacy-peer-deps >"$AGENT_OS_HOME/install.log" 2>&1 || die "Install failed. Details: $AGENT_OS_HOME/install.log"
NODE_ENV=production npm run build >>"$AGENT_OS_HOME/install.log" 2>&1 || die "Build failed. Details: $AGENT_OS_HOME/install.log"
mkdir -p "$HOME/.local/bin"
ln -sf "$REPO_DIR/scripts/agent-os" "$HOME/.local/bin/agent-os"

step "4 of 4  Linking"
exec /bin/bash "$REPO_DIR/scripts/agentos-machine.sh" link "$INVITE"
