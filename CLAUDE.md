# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

`@elabx-org/agent-os` — a fork of [saadnvd1/agent-os](https://github.com/saadnvd1/agent-os) adding container compatibility for [docker-code-server](https://github.com/elabx-org/docker-code-server). Published to GitHub Packages npm registry. Upstream remote is named `upstream`.

## Commands

### NPM Scripts
```bash
npm run dev          # Dev server (tsx server.ts) on http://0.0.0.0:3011
npm run build        # Next.js production build
npm start            # Production server (NODE_ENV=production tsx server.ts)
npm run lint         # ESLint
npm run format       # Prettier
npm run typecheck    # tsc --noEmit
npm run setup        # Run scripts/setup.sh (checks/installs tmux, ripgrep, builds app)
```

### Agent-OS CLI (installed globally)
```bash
agent-os install          # Install dependencies (tmux, ripgrep, Claude Code)
agent-os start            # Start server in background
agent-os stop             # Stop server
agent-os restart          # Restart server
agent-os run              # Start and open browser
agent-os status           # Show server status and URLs
agent-os logs             # Tail server logs
agent-os update           # Pull latest from git and rebuild
agent-os deploy           # Deploy from local dev repo (rsync + build + restart)
agent-os deploy --publish # Deploy + publish to GitHub Packages registry
agent-os start-foreground # Start in foreground (for debugging)
```

No test suite exists. Husky pre-commit hook runs Prettier on staged files and `npm run typecheck`.

## Architecture

**Next.js 16 App Router** with a **custom HTTP server** (`server.ts`) that wraps Next.js to add WebSocket support for terminals.

### Server Layer (`server.ts`)

Custom Node.js HTTP server that:
- Delegates HTTP requests to Next.js `handle()`
- Runs a WebSocket server at `/ws/terminal` using `ws`
- Spawns PTY processes via `node-pty` for each WebSocket connection
- Container-optimized: defaults to `/bin/bash`, HOME=`/config`, USER=`abc`, expanded PATH
- 5-minute PTY grace period on WebSocket disconnect (keeps Claude Code alive during network blips)
- 200KB circular output buffer per session replayed on reconnect
- Application-level ping/pong heartbeat (25s interval, 10s timeout)

### Database (`lib/db/`)

SQLite via `better-sqlite3` in WAL mode. No ORM — raw SQL with a prepared statement cache.

- **`schema.ts`** — DDL for base tables (sessions, messages, tool_calls, projects, dev_servers, project_dev_servers, project_repositories, groups)
- **`migrations.ts`** — Incremental schema migrations (16 so far) that add columns/tables. Run automatically on startup.
- **`queries.ts`** — Prepared statement factories, exported as `queries` object
- **`types.ts`** — TypeScript interfaces for all DB row types
- **`index.ts`** — DB initialization, exports `db` singleton

Database file: `agent-os.db` in project root (or `$DB_PATH`). Base schema uses `CREATE TABLE IF NOT EXISTS`, then `migrations.ts` applies additive `ALTER TABLE` / new tables with try-catch.

**Adding a migration:** Append a new entry to the `migrations` array in `migrations.ts` with the next sequential `id`, a descriptive `name`, and an `up(db)` function. Never modify existing migrations. Applied migrations are tracked in the `_migrations` table with `INSERT OR IGNORE` for concurrent-worker safety.

### API Routes (`app/api/`)

Standard Next.js route handlers. Key endpoint groups:
- `/api/sessions` — CRUD + `/[id]/fork`, `/[id]/messages`, `/[id]/preview`, `/[id]/send-keys`, `/[id]/claude-session`, `/status`
- `/api/projects` — CRUD + `/[id]/dev-servers`, `/[id]/repositories`
- `/api/git/` — status, multi-status, commit, push, pr, history, checkout, sync, discard, file-content
- `/api/dev-servers` — lifecycle management
- `/api/orchestrate/` — spawn/manage worker sessions
- `/api/code-search` — ripgrep-powered search
- `/api/files` — browse, read/write content, upload
- `/api/claude-cli`, `/api/claude-usage` — Claude Code CLI integration
- `/api/github-raw` — proxy for private repo raw file access
- `/api/tmux-sessions` — tmux session listing

### Data Layer (`data/`)

TanStack Query abstractions organized by domain: `sessions/`, `projects/`, `git/`, `dev-servers/`, `repositories/`, `statuses/`, `code-search/`, `groups/`. Each domain exports query keys (`keys.ts`) and query/mutation hooks (`queries.ts`). Use these hooks in components rather than calling `fetch` directly.

### State Management (Frontend)

Three-layer approach:
- **TanStack Query** — server state via `data/` hooks (sessions, projects, git status) with polling
- **Valtio** — UI state in `stores/`: `sessionSelection` (multi-select with shift-click), `initialPrompt` (pending prompts), `fileOpen` (file open requests with path/line)
- **React Context** — pane layout (`contexts/PaneContext`)

### Key Frontend Libraries

- **xterm.js** (`@xterm/xterm`) — terminal emulator in `components/Terminal/`
- **Radix UI** — headless primitives (dialogs, menus, dropdowns, etc.)
- **Monaco Editor** — file editing
- **shadcn/ui** pattern — components in `components/ui/`
- **Tailwind CSS 4** — styling

### Session Orchestration (`lib/orchestration.ts`, `mcp/`)

Conductor/worker model: a conductor session spawns isolated workers via MCP tools. Workers get their own git worktrees (`lib/worktrees.ts`, stored in `~/.agent-os/worktrees/`) and auto-named branches. The MCP server (`mcp/orchestration-server.ts`) exposes 7 tools: `spawn_worker`, `list_workers`, `get_worker_output`, `send_to_worker`, `complete_worker`, `kill_worker`, `get_workers_summary`. Uses `AGENTOS_URL` env var (default `http://localhost:3011`).

### Agent Providers (`lib/providers/`)

Abstraction over AI CLIs (Claude Code, Codex, OpenCode, Gemini CLI, Aider, Cursor CLI, plain Shell). Central registry in `registry.ts` defines each provider's CLI command, config directory, auto-approve flag, resume/fork/model support, and status detection patterns (waiting/running/idle). Each provider knows how to construct the CLI command, handle resume/fork, and parse output.

| Agent       | Resume | Fork | Auto-Approve Flag                     | Install Command |
| ----------- | ------ | ---- | ------------------------------------- | --------------- |
| Claude Code | ✅     | ✅   | `--dangerously-skip-permissions`      | `npm i -g @anthropic-ai/claude-code` |
| Minimax     | ✅     | ✅   | `--dangerously-skip-permissions`      | (manual alias) |
| Codex       | ❌     | ❌   | `--approval-mode full-auto`           | `npm i -g @openai/codex` |
| OpenCode    | ✅     | ✅   | `--dangerously-skip-permissions`      | `curl -fsSL https://opencode.ai/install \| bash` |
| Gemini CLI  | ❌     | ❌   | `--yolomode`                         | `npm i -g @google/gemini-cli` |
| Aider       | ❌     | ❌   | `--yes`                               | `pipx install aider-chat` |
| Cursor CLI  | ❌     | ❌   | N/A                                   | (manual) |
| Cline       | ❌     | ❌   | `-y`                                  | `npm i -g cline` |

The UI shows which CLIs are installed at runtime via `GET /api/cli-status` and offers one-click installation via `POST /api/cli-install` using each provider's `installCommand` from the registry.

### Adding a New Provider

1. **Registry** (`lib/providers/registry.ts`):
   - Add the provider ID string to `PROVIDER_IDS` array
   - Add a `ProviderDefinition` entry to `PROVIDERS` with: `cli` (binary name), `configDir`, `autoApproveFlag`, `supportsResume`/`supportsFork`, `resumeFlag`/`continueFlag`, `modelFlag`, `initialPromptFlag` (`""` = positional, string = flag, `undefined` = no support), `installCommand`

2. **Provider logic** (`lib/providers.ts`):
   - Create an `AgentProvider` object with `buildFlags(options)` that constructs CLI arguments, plus `waitingPatterns`/`runningPatterns`/`idlePatterns` regex arrays for status detection
   - Add it to the `providers` record (keyed by provider ID)

3. **UI dropdown** (`components/NewSessionDialog/NewSessionDialog.types.ts`):
   - Add `{ value, label, description }` entry to `AGENT_OPTIONS` array

4. **Install script** (`scripts/lib/ai-clis.sh`):
   - Add `command -v <cli>` check in `detect_ai_clis()`
   - Add `install_<name>()` function
   - Add menu entry in `prompt_ai_cli_install()`

5. **Documentation**: Update the provider table above

### Store Sync (`lib/store-sync.ts`)

Background sync of skills/agents from GitHub repositories every 30 minutes. Three built-in sources are auto-seeded on startup. Items stored in `store_sources` / `store_items` tables.

### WebSocket Protocol (`/ws/terminal`)

Client → Server message types: `input` (PTY input), `paste` (clipboard paste, wrapped in bracketed paste markers), `resize` (terminal dimensions), `command` (input + `\r`), `exec` (run command outside PTY, returns `exec-result`). Server → Client: `output` (PTY data), `exit` (PTY exited), `error`, `exec-result`. Client auto-reconnects with exponential backoff; visibility-based forced reconnect handles mobile Safari socket death.

## Fork-Specific Changes

### Container Compatibility (`server.ts`)
- Shell: `/bin/bash` (not zsh), spawned with `-l` flag
- PATH includes `/config/.npm-global/bin`, `/config/.local/bin`
- HOME defaults to `/config`, USER to `abc`
- PTY grace period: 5-minute delayed kill on disconnect

### Bug Fixes
- **`app/api/sessions/[id]/route.ts`** — `projectId` handling in PATCH
- **`components/Projects/ProjectCard.tsx`**, **`components/SessionCard.tsx`** — `onSelect` instead of `onClick` on Radix MenuItems (mobile fix), rename focus fix
- **`app/api/sessions/[id]/fork/route.ts`**, **`app/api/sessions/[id]/summarize/route.ts`** — Added missing `continue_session` parameter to `createSession` calls
- **`components/Terminal/hooks/websocket-connection.ts`** — Fixed garbled terminal output on WebSocket reconnect (replaced `term.reset()` with clear sequence to avoid visible escape codes)
- **Terminal paste** — Fixed paste corruption by adding bracketed paste mode (`\x1b[200~...\x1b[201~`) via dedicated `paste` WebSocket message type, and setting tmux `escape-time 10`

## Development Workflow

### Adding Features
1. Make changes, commit and push to `origin` (elabx-org/agent-os)
2. `npm version patch` (or `minor`/`major`)
3. `npm publish --registry=https://npm.pkg.github.com`
4. docker-code-server picks up the new version on next startup

### Deploying to Running Instance
The running agent-os server lives at `/config/.agent-os/repo/`. Use the CLI:
```bash
agent-os deploy           # Rsync from dev repo → production, build, restart
agent-os deploy --publish # Same + publish to GitHub Packages first
agent-os update           # Pull from git remote + rebuild (auto-stashes dirty state)
```

### Merging Upstream
```bash
git fetch upstream
git merge upstream/main
# Resolve conflicts — our changes are in server.ts, route.ts, SessionCard.tsx, ProjectCard.tsx
git push origin main
npm version patch && npm publish --registry=https://npm.pkg.github.com
```

### Publishing Auth
Requires GitHub token with `write:packages` scope. Use `gh auth token` for the value:
```bash
echo "//npm.pkg.github.com/:_authToken=$(gh auth token)" > .npmrc
echo "@elabx-org:registry=https://npm.pkg.github.com" >> .npmrc
```
Do not commit `.npmrc`.

## Docker & CI

### Dockerfile
Multi-stage build (`node:20-bookworm` builder → `node:20-bookworm-slim` runtime). Installs tmux, ripgrep, git, gh CLI, and Claude Code globally. Runs as user `abc` (uid 1000) with HOME=`/config`. Volumes: `/config` (persistent data, DB), `/workspace` (code). Health check on port 3011.

### GitHub Actions (`.github/workflows/docker.yml`)
Builds and pushes Docker image to `ghcr.io/elabx-org/agent-os` on push to `main` or version tags. Multi-platform: `linux/amd64` + `linux/arm64`. Uses GHA cache.

## Path Aliases & Config

- TypeScript path alias: `@/*` maps to `./` (use `@/lib/...`, `@/components/...`, etc.)
- `next.config.ts`: Minimal — only disables devIndicators
- `tsconfig.json` excludes `packages/` to avoid build errors from monorepo subdirectories
- shadcn/ui: New York style, Tailwind CSS variables, Lucide icons (`components.json`)

## Environment Variables

- `PORT` — Server port (default `3011`)
- `DB_PATH` — SQLite database path (default `./agent-os.db`)
- `AGENTOS_URL` — Base URL for MCP orchestration (default `http://localhost:3011`)

## Prerequisites

Node.js 20+, tmux, ripgrep. At least one AI CLI installed (Claude Code, Codex, etc.).

## Mobile Access

Use [Tailscale](https://tailscale.com) for secure access from your phone:

1. Install Tailscale on your dev machine and phone
2. Sign in with the same account
3. Access `http://100.x.x.x:3011` from your phone
