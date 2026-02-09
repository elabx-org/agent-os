# CLAUDE.md

This is the `@elabx-org/agent-os` fork of [saadnvd1/agent-os](https://github.com/saadnvd1/agent-os).

## Fork Overview

This fork adds container compatibility fixes and bug fixes for running Agent-OS inside [docker-code-server](https://github.com/elabx-org/docker-code-server). All fixes are maintained as proper commits rather than runtime sed patches.

**Published to**: GitHub Packages npm registry as `@elabx-org/agent-os`
**Upstream**: `https://github.com/saadnvd1/agent-os.git` (remote: `upstream`)

## Changes from Upstream

### Container Compatibility (server.ts)
- Default shell: `/bin/bash` instead of `/bin/zsh`
- Expanded PATH: includes `/config/.npm-global/bin`, `/config/.local/bin`, sbin dirs
- Default HOME: `/config` instead of `/`
- Default USER: `abc` instead of empty string
- Login shells: terminals spawn with `-l` flag to load `.bashrc`
- PTY grace period: 5-minute delayed kill on WebSocket disconnect (prevents running Claude Code sessions from dying during brief network interruptions)

### Bug Fixes
- **Session PATCH API**: Added `projectId` handling so sessions can be moved between projects
- **Radix UI menus**: Changed `onClick` to `onSelect` on all MenuItem components (fixes delete/rename failing on mobile/touch)
- **Rename focus**: Extended blur protection and added re-focus after Radix UI context menu close (fixes rename input losing focus)

## Development Workflow

### Adding Features
1. Make changes in the local clone (`/config/workspace/gh/agent-os`)
2. Commit and push to `origin` (elabx-org/agent-os)
3. Bump version: `npm version patch` (or `minor`/`major`)
4. Publish: `npm publish --registry=https://npm.pkg.github.com`
5. The docker-code-server container will pick up the new version on next startup

### Merging Upstream Changes
```bash
cd /config/workspace/gh/agent-os
git fetch upstream
git merge upstream/main
# Resolve any conflicts (our changes are in server.ts, route.ts, SessionCard.tsx, ProjectCard.tsx)
git push origin main
# Then bump version and publish
npm version patch
npm publish --registry=https://npm.pkg.github.com
```

### Publishing to GitHub Packages
Requires a GitHub token with `write:packages` scope. Configure auth before publishing:
```bash
echo "//npm.pkg.github.com/:_authToken=YOUR_TOKEN" > .npmrc
echo "@elabx-org:registry=https://npm.pkg.github.com" >> .npmrc
npm publish
```
Note: Do not commit `.npmrc` (it contains auth tokens). Use `gh auth token` for the token value.

## Key Files (Modified from Upstream)

| File | Changes |
|------|---------|
| `server.ts` | Container compat: bash, PATH, HOME, USER, login shells, PTY grace period |
| `app/api/sessions/[id]/route.ts` | Added projectId handling to PATCH |
| `components/Projects/ProjectCard.tsx` | onSelect fix, rename focus fix |
| `components/SessionCard.tsx` | onSelect fix, rename focus fix |
| `package.json` | Rebranded to @elabx-org/agent-os, GitHub Packages publishConfig |
| `scripts/agent-os` | REPO_URL points to elabx-org/agent-os |
| `scripts/install.sh` | REPO_URL points to elabx-org/agent-os |

## Build and Test

```bash
# Install dependencies
npm install

# Development mode
npm run dev

# Production build
npm run build

# Start production server
npm start
```
