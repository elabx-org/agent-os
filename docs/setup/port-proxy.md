# Port proxy

Agent-OS can open apps that run inside its container (a Vite dev server, a
CLI's OAuth callback, any port) without publishing that port on the host,
the way code-server's `/proxy/<port>/` does.

| URL                                   | The app receives                                  |
| ------------------------------------- | ------------------------------------------------- |
| `/proxy/<port>/<path>`                | `/<path>` (prefix stripped)                       |
| `/absproxy/<port>/<path>`             | `/absproxy/<port>/<path>` (app configured with that base) |
| `https://<port>.<domain>/<path>` (subdomain mode) | `/<path>`                             |

Only `127.0.0.1` / `::1` are ever contacted. The Agent-OS port (and 3011)
is refused, as are ports in `AGENTOS_PROXY_DENY_PORTS`. HTTP and WebSocket
(HMR) both work; bodies stream (SSE, long polls) and compressed responses
pass through untouched. Redirects to `localhost:<any port>` are rewritten
into the proxy. When nothing listens, a page says so and reloads every 3s.

`GET /api/ports` lists listening ports (with process names) and the proxy
settings.

## Security model

A path-mode app is served from Agent-OS's own origin. Left alone, its
JavaScript could call Agent-OS's API or open a terminal with the user's
cookies. So:

- Every path-mode response carries an extra
  `Content-Security-Policy: sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads allow-pointer-lock allow-presentation`
  (never `allow-same-origin`). The page runs in an opaque origin: no
  Agent-OS cookies readable, no `localStorage`, no same-origin access to
  Agent-OS frames. The app's own CSP still applies.
- The **origin gate** (`lib/origin-gate.ts`) refuses calls to `/api/*`,
  `/ws/*` and `/auth/logout` with `Origin: null`, a foreign Origin,
  `Sec-Fetch-Site: cross-site|same-site` (except navigations), or a Referer
  under `/proxy/`, `/absproxy/` or a port host. Tools without a browser
  (curl, the MCP server) send none of these and pass.
- Agent-OS's and Authelia's cookies (`agentos_*`, `authelia_session`),
  `Authorization` and Authelia's `Remote-*` headers are never sent to the
  app. The app can't set `agentos_*` / `__Host-` / `__Secure-` cookies or a
  cookie `Domain`, and its HSTS / `Clear-Site-Data` / `Alt-Svc` headers are
  dropped.
- With Agent-OS sign-in on, proxy paths need sign-in like every route.

### Path-mode limit behind a sign-in front door

A sandboxed page has an opaque origin, so its subresource requests
(scripts, styles, fetches) are cross-site and carry no `SameSite=Lax`
cookies, such as Authelia's. The page itself loads (it is your own
navigation), so OAuth callbacks and single-document pages work, but a
multi-file app's assets get redirected to the login. Behind Authelia, use
subdomain mode for full dev previews. On a LAN without a front door, path
mode works fully.

## Settings

| Env                                 | Effect |
| ----------------------------------- | ------ |
| `AGENTOS_PROXY=0`                   | Proxy off (also the Labs flag "Port proxy") |
| `AGENTOS_PROXY_DOMAIN=d`            | Subdomain mode on `<port>.d` (also `proxyDomain` in `$AGENT_OS_HOME/proxy.json`) |
| `AGENTOS_PROXY_DENY_PORTS=a,b`      | More refused ports, e.g. `8443` for code-server |
| `AGENTOS_PROXY_STRIP_COOKIES=x,y_*` | More cookies never sent to apps |
| `AGENTOS_PROXY_SUBDOMAIN_SANDBOX=1` | Sandbox port hosts too |
| `AGENTOS_PROXY_SANDBOX=0`           | **Unsafe**: no sandbox in path mode (code-server parity; proxied apps can control Agent-OS) |
| `AGENTOS_ORIGIN_GATE=0`             | Turns the origin gate off (escape hatch) |
| `AGENTOS_PUBLIC_URL=https://…`      | Where browser-helper links point (also `publicUrl` in `proxy.json`) |
| `AGENTOS_BROWSER_HELPER=0`          | Sessions don't get `BROWSER` |

Use `AGENTOS_PUBLIC_URL`, not `AGENT_OS_PUBLIC_URL`: the latter belongs to
OIDC sign-in, and setting it alone makes Agent-OS refuse to start
(half-configured sign-in).

## Browser helper

Sessions get `BROWSER=$AGENT_OS_HOME/bin/agentos-browser` and
`AGENTOS_URL=http://127.0.0.1:<port>` (set in the generated session init
script; shell sessions launched by the server get them through tmux).
When a CLI (`codex login`, `gemini`, `gh auth login --web`, `claude`) opens
a link, the helper posts it to `POST /api/browser-open`; the page shows a
toast "Open sign-in link" (localhost links, opened via `/proxy/<port>/…`)
or "Open link" (external sign-in pages). The helper also prints the link
and always exits 0. Localhost links use `/proxy`, not `/absproxy`: callback
servers expect their exact registered path.

Sessions started before this change keep their old environment until they
are relaunched. Shell sessions opened from the page don't get `BROWSER` yet.

## Subdomain mode: what to add (not done by Agent-OS)

Example for `agent.elabx.app`:

1. **DNS (Technitium)**: a wildcard record `*.agent.elabx.app` pointing where
   `agent.elabx.app` points (CNAME `agent.elabx.app.` or the same A record).
2. **TLS**: `*.elabx.app` does not cover `*.agent.elabx.app`. Have Traefik's
   certResolver (DNS challenge) issue
   `tls.domains: [{ main: "agent.elabx.app", sans: ["*.agent.elabx.app"] }]`.
3. **Traefik v3 router**, same service as `agent.elabx.app` (port 3011):
   ```yaml
   rule: HostRegexp(`^[0-9]+\.agent\.elabx\.app$`)
   middlewares: [authelia@docker]   # the same forward-auth as agent.elabx.app
   service: agent-os
   tls: { certResolver: <resolver> }
   ```
   Keep the Host header (Traefik's default).
4. **Authelia** `access_control`, same policy and subject as
   `agent.elabx.app`:
   ```yaml
   - domain_regex: '^\d+\.agent\.elabx\.app$'
     policy: one_factor
     subject: ['group:<your group>']
   ```
   The session cookie domain stays `elabx.app`, so one sign-in covers both.
5. **Agent-OS**: `AGENTOS_PROXY_DOMAIN=agent.elabx.app`, restart.

Each port then has its own origin (`https://5173.agent.elabx.app`), so no
sandbox is needed and everything a dev server does works. A port host only
ever serves the app: `/api`, `/ws/terminal` and `/auth` on it go to the
app, not Agent-OS. Agent-OS's own sign-in (OIDC) does not reach port hosts
(its cookie is host-only), so with OIDC on, gate port hosts in the front
door; otherwise they answer 401 to non-loopback callers.

## Risks

- On a LAN with no sign-in anywhere, the proxy exposes every loopback-only
  service in the container to whoever can reach Agent-OS (code-server's
  proxy does too). Turn it off with the Labs flag or `AGENTOS_PROXY=0`.
- Any process in the container, agents included, can raise a link toast;
  it is rate-limited and always shows the host and the session.
