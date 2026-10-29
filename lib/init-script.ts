import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  exportLines,
  sessionBrowserEnv,
  type SessionBrowserEnv,
} from "./browser-helper";

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
# Scroll 5 lines per wheel event instead of 1 for smoother scrolling
tmux bind-key -T copy-mode WheelUpPane send-keys -X -N 5 scroll-up 2>/dev/null
tmux bind-key -T copy-mode WheelDownPane send-keys -X -N 5 scroll-down 2>/dev/null
tmux bind-key -T copy-mode-vi WheelUpPane send-keys -X -N 5 scroll-up 2>/dev/null
tmux bind-key -T copy-mode-vi WheelDownPane send-keys -X -N 5 scroll-down 2>/dev/null
# No status line: AgentOS's header already names the session, and on a phone
# the keyboard leaves few enough rows
tmux set-option status off 2>/dev/null
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
exec ${agentCommand}
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
