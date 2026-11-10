import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  exportLines,
  sessionBrowserEnv,
  type SessionBrowserEnv,
} from "./browser-helper";

const UUID = /([0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

/**
 * The background job a Claude resume may find its conversation in. Claude
 * can move a session to its background agents (`claude agents`); --resume
 * then refuses it and exits, so the tmux closes as it opens. Its job id is
 * the session id's first 8 characters. Null for anything but a plain Claude
 * resume (a fork opens a copy, which --resume allows).
 */
export function backgroundJobId(agentCommand: string): string | null {
  if (!/^claude\s/.test(agentCommand.trim())) return null;
  if (/\s--fork-session\b/.test(agentCommand)) return null;
  const resume = agentCommand.match(/\s--resume\s+(\S+)/);
  const id = resume?.[1].match(UUID);
  return id ? id[1] : null;
}

/** Opens a backgrounded conversation in place of a resume that would refuse it */
function attachLines(agentCommand: string): string {
  const job = backgroundJobId(agentCommand);
  if (!job) return "";
  return `# In Claude's background agents, --resume refuses this conversation:
# open it there instead (no such job: carry on and resume it)
claude attach ${job} 2>/dev/null && exit 0
`;
}

/**
 * Generate an init script that shows the AgentOS banner and configures tmux
 */
function generateInitScript(
  agentCommand: string,
  browser: SessionBrowserEnv = { env: {}, browser: null, force: false }
): string {
  return `#!/bin/bash
# AgentOS Session Init Script
# Auto-generated - do not edit manually

# ANSI Colors (purple theme)
C_RESET=$'\\033[0m'
C_PURPLE=$'\\033[38;5;141m'
C_PURPLE2=$'\\033[38;5;177m'
C_PINK=$'\\033[38;5;213m'
C_MUTED=$'\\033[38;5;245m'

# Configure tmux for scrolling
tmux set-option -g mouse on 2>/dev/null
tmux set-option -sg escape-time 10 2>/dev/null
tmux set-option -g history-limit 50000 2>/dev/null
# A row per wheel event: the page sends one per row of finger or wheel
# travel (components/Terminal/hooks/touch-scroll.ts, wheel.ts)
tmux bind-key -T copy-mode WheelUpPane send-keys -X scroll-up 2>/dev/null
tmux bind-key -T copy-mode WheelDownPane send-keys -X scroll-down 2>/dev/null
tmux bind-key -T copy-mode-vi WheelUpPane send-keys -X scroll-up 2>/dev/null
tmux bind-key -T copy-mode-vi WheelDownPane send-keys -X scroll-down 2>/dev/null
# No status line: AgentOS's header already names the session, and on a phone
# the keyboard leaves few enough rows
tmux set-option status off 2>/dev/null
# True colour: the page's terminal draws RGB (server.ts sets COLORTERM), so
# tmux passes Claude's diff backgrounds on instead of the nearest 256 colour.
# Read when a client attaches; once per server, not appended every time
tmux show-options -s terminal-features 2>/dev/null | grep -q 'xterm-256color:RGB' || tmux set-option -as terminal-features ',xterm-256color:RGB' 2>/dev/null
tmux bind-key m display-menu -T "Tmux" -x R -y P "Copy Mode" c copy-mode "Paste Buffer" p paste-buffer "" "" "" "Split Horizontal" h "split-window -h" "Split Vertical" v "split-window -v" "" "" "" "Kill Pane" x "confirm-before kill-pane" 2>/dev/null

# Clear and show banner
clear

printf "\\n"
printf "\${C_PURPLE}     _                    _    ___  ____  \${C_RESET}\\n"
printf "\${C_PURPLE}    / \\\\   __ _  ___ _ __ | |_ / _ \\\\/ ___| \${C_RESET}\\n"
printf "\${C_PURPLE2}   / _ \\\\ / _\\\` |/ _ \\\\ '_ \\\\| __| | | \\\\___ \\\\ \${C_RESET}\\n"
printf "\${C_PURPLE2}  / ___ \\\\ (_| |  __/ | | | |_| |_| |___) |\${C_RESET}\\n"
printf "\${C_PINK} /_/   \\\\_\\\\__, |\\\\___|_| |_|\\\\__|\\\\___/|____/ \${C_RESET}\\n"
printf "\${C_PINK}         |___/                            \${C_RESET}\\n"
printf "\\n"
printf "\${C_MUTED}         AI Coding Session Manager\${C_RESET}\\n"
printf "\\n"

# Brief pause to show banner
sleep 0.8

# Ensure ~/.local/bin is in PATH (where claude is installed)
export PATH="$HOME/.local/bin:$PATH"

# Sign-in links CLIs open go to Agent-OS (lib/browser-helper.ts)
${exportLines(browser)}
# Start the agent
${attachLines(agentCommand)}exec ${agentCommand}
`;
}

/** Writes the init script for an agent command; returns what tmux runs */
export function writeInitScript(agentCommand: string): string {
  const scriptPath = path.join(
    os.tmpdir(),
    `agent-os-init-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.sh`
  );
  fs.writeFileSync(
    scriptPath,
    generateInitScript(agentCommand, sessionBrowserEnv()),
    {
      mode: 0o755,
    }
  );
  return `bash ${scriptPath}`;
}
