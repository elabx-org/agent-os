# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

`@elabx-org/agent-os` — a fork of [saadnvd1/agent-os](https://github.com/saadnvd1/agent-os) adding container compatibility for [docker-code-server](https://github.com/elabx-org/docker-code-server). Published to GitHub Packages npm registry. Upstream remote is named `upstream`.

## Commands

```bash
npm run dev          # Dev server (tsx server.ts) on http://0.0.0.0:3011
npm run build        # Next.js production build
npm start            # Production server (NODE_ENV=production tsx server.ts)
npm run lint         # ESLint
npm run format       # Prettier
npm run typecheck    # tsc --noEmit
```

No test suite exists.

## Architecture

**Next.js 16 App Router** with a **custom HTTP server** (`server.ts`) that wraps Next.js to add WebSocket support for terminals.

### Server Layer (`server.ts`)

Custom Node.js HTTP server that:
- Delegates HTTP requests to Next.js `handle()`
- Runs a WebSocket server at `/ws/terminal` using `ws`
- Spawns PTY processes via `node-pty` for each WebSocket connection
- Container-optimized: defaults to `/bin/bash`, HOME=`/config`, USER=`abc`, expanded PATH
- 5-minute PTY grace period on WebSocket disconnect (keeps Claude Code alive during network blips)

### Database (`lib/db/`)

SQLite via `better-sqlite3` in WAL mode. No ORM — raw SQL with a prepared statement cache.

- **`schema.ts`** — DDL for all tables (sessions, messages, tool_calls, projects, dev_servers, project_dev_servers, project_repositories, groups)
- **`queries.ts`** — Prepared statement factories, exported as `queries` object
- **`index.ts`** — DB initialization, exports `db` singleton

Database file: `agent-os.db` in project root (or `$DB_PATH`). Schema migrations are additive `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE` with try-catch.

### API Routes (`app/api/`)

Standard Next.js route handlers. Key endpoints:
- `/api/sessions` — CRUD + `/[id]/fork`, `/[id]/messages`, `/status`
- `/api/projects` — CRUD + `/[id]/dev-servers`, `/[id]/repositories`
- `/api/git/` — status, commit, push, pr, history
- `/api/dev-servers` — lifecycle management
- `/api/orchestrate/` — spawn/manage worker sessions
- `/api/code-search` — ripgrep-powered search
- `/api/files` — browse, read/write content, upload

### State Management (Frontend)

Three-layer approach:
- **TanStack Query** — server state (sessions, projects, git status) with polling
- **Valtio** — UI state (session selection in `stores/`)
- **React Context** — pane layout (`contexts/PaneContext`)

### Key Frontend Libraries

- **xterm.js** (`@xterm/xterm`) — terminal emulator in `components/Terminal/`
- **Radix UI** — headless primitives (dialogs, menus, dropdowns, etc.)
- **Monaco Editor** — file editing
- **shadcn/ui** pattern — components in `components/ui/`
- **Tailwind CSS 4** — styling

### Session Orchestration (`lib/orchestration.ts`, `mcp/`)

Conductor/worker model: a conductor session spawns isolated workers via MCP tools. Workers get their own git worktrees (`lib/worktrees.ts`) and branches. The MCP server (`mcp/`) provides `spawn_worker`, `list_workers`, `send_to_worker`, etc.

### Agent Providers (`lib/providers/`)

Abstraction over AI CLIs (Claude Code, Codex, OpenCode, Gemini CLI, Aider, Cursor CLI, plain Shell). Each provider knows how to construct the CLI command, handle resume/fork, and parse output.

## Fork-Specific Changes

### Container Compatibility (`server.ts`)
- Shell: `/bin/bash` (not zsh), spawned with `-l` flag
- PATH includes `/config/.npm-global/bin`, `/config/.local/bin`
- HOME defaults to `/config`, USER to `abc`
- PTY grace period: 5-minute delayed kill on disconnect

### Bug Fixes
- **`app/api/sessions/[id]/route.ts`** — `projectId` handling in PATCH
- **`components/Projects/ProjectCard.tsx`**, **`components/SessionCard.tsx`** — `onSelect` instead of `onClick` on Radix MenuItems (mobile fix), rename focus fix

## Development Workflow

### Adding Features
1. Make changes, commit and push to `origin` (elabx-org/agent-os)
2. `npm version patch` (or `minor`/`major`)
3. `npm publish --registry=https://npm.pkg.github.com`
4. docker-code-server picks up the new version on next startup

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

## Prerequisites

Node.js 20+, tmux, ripgrep. At least one AI CLI installed (Claude Code, Codex, etc.).
