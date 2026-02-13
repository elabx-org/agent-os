# ============================================================
# Stage 1: Builder — install deps and build Next.js
# ============================================================
FROM node:20-bookworm AS builder

WORKDIR /app

# Copy package files for layer caching
COPY package.json package-lock.json ./

# Install all dependencies (tsx is a devDep but needed at runtime)
# better-sqlite3 and node-pty need native build tools (available in bookworm)
RUN npm ci --legacy-peer-deps

# Copy application source
COPY . .

# Build Next.js production output
RUN npm run build

# ============================================================
# Stage 2: Runtime — slim production image
# ============================================================
FROM node:20-bookworm-slim

ARG BUILD_DATE
ARG VCS_REF
ARG VERSION

LABEL org.opencontainers.image.title="agent-os" \
      org.opencontainers.image.description="Self-hosted web UI for managing Claude Code sessions" \
      org.opencontainers.image.source="https://github.com/elabx-org/agent-os" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.version="${VERSION}"

# Install system packages:
#   tmux        — terminal multiplexer (required for session management)
#   ripgrep     — fast code search (required for /api/code-search)
#   git         — version control + worktree support
#   gh          — GitHub CLI for PRs and API access
#   curl, wget  — HTTP utilities
#   jq          — JSON processing
#   openssh-client — git SSH operations
#   python3, make, g++ — fallback native module compilation
RUN apt-get update && apt-get install -y --no-install-recommends \
    tmux \
    ripgrep \
    git \
    curl \
    wget \
    jq \
    openssh-client \
    bash \
    ca-certificates \
    gnupg \
    python3 \
    make \
    g++ \
    && mkdir -p -m 755 /etc/apt/keyrings \
    && wget -qO- https://cli.github.com/packages/githubcli-archive-keyring.gpg \
       | tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \
    && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
       | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update \
    && apt-get install -y --no-install-recommends gh \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI globally
RUN npm install -g @anthropic-ai/claude-code

# Create user and directories matching server.ts container defaults
RUN groupadd -g 1000 abc \
    && useradd -u 1000 -g abc -d /config -s /bin/bash abc \
    && mkdir -p /config /config/.npm-global /config/.local/bin /config/.agent-os /workspace \
    && chown -R abc:abc /config /workspace

ENV NPM_CONFIG_PREFIX=/config/.npm-global

WORKDIR /app

# Copy node_modules with built native modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy Next.js build output
COPY --from=builder /app/.next ./.next

# Copy source files needed at runtime (tsx transpiles server.ts on-the-fly)
COPY --from=builder /app/package.json ./
COPY --from=builder /app/server.ts ./
COPY --from=builder /app/next.config.ts ./
COPY --from=builder /app/postcss.config.mjs ./
COPY --from=builder /app/tsconfig.json ./
COPY --from=builder /app/app ./app
COPY --from=builder /app/components ./components
COPY --from=builder /app/contexts ./contexts
COPY --from=builder /app/data ./data
COPY --from=builder /app/hooks ./hooks
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/mcp ./mcp
COPY --from=builder /app/public ./public
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/stores ./stores
COPY --from=builder /app/styles ./styles

# Ensure node-pty spawn-helper is executable
RUN chmod +x node_modules/node-pty/prebuilds/*/spawn-helper 2>/dev/null || true

# Container environment matching server.ts defaults
ENV HOME=/config \
    USER=abc \
    SHELL=/bin/bash \
    PORT=3011 \
    DB_PATH=/config/agent-os.db \
    NODE_ENV=production \
    PATH="/config/.npm-global/bin:/config/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

EXPOSE 3011

# Persistent data volumes
VOLUME ["/config", "/workspace"]

USER abc

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3011/ || exit 1

CMD ["npx", "tsx", "server.ts"]
