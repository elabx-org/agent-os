# Port proxy

Agent-OS can open apps that run inside its container (a Vite dev server, a
CLI's OAuth callback, any port) without publishing that port on the host,
the way code-server's `/proxy/<port>/` does.

| URL                                               | The app receives                                          |
| ------------------------------------------------- | --------------------------------------------------------- |
| `/proxy/<port>/<path>`                            | `/<path>` (prefix stripped)                               |
| `/absproxy/<port>/<path>`                         | `/absproxy/<port>/<path>` (app configured with that base) |
| `https://<port>.<domain>/<path>` (subdomain mode) | `/<path>`                                                 |

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
  `Sec-Fetch-Site: cross-site|same-site` (navigations too, except to
  `/auth/logout`), or a Referer under `/proxy/`, `/absproxy/` or a port
  host. Tools without a browser (curl, the MCP server) send none of these
  and pass. The gate is independent of the proxy flag: turning the proxy
  off leaves it on (`AGENTOS_ORIGIN_GATE=0` turns it off).
- Agent-OS's and Authelia's cookies (`agentos_*`, `authelia_session`),
  `Authorization` and Authelia's `Remote-*` headers are never sent to the
  app. The app can't set `agentos_*` / `__Host-` / `__Secure-` cookies or a
  cookie `Domain`, and its HSTS / `Clear-Site-Data` / `Alt-Svc` headers are
  dropped.
- **Cookie paths are forced under the prefix** in both path modes: in
  `/proxy/<port>/` a `Path=/x` becomes `Path=/proxy/<port>/x`; in
  `/absproxy/<port>/` any path outside `/absproxy/<port>/` becomes
  `/absproxy/<port>/`. So an app can't fill Agent-OS's own paths with
  cookies (a "cookie bomb" would make every Agent-OS request fail with
  431). At most 32 `Set-Cookie` headers of up to 4 KB each per response.
- **`Origin: null` is only trusted from our own page.** Any website can
  make a sandboxed iframe whose Origin is `null`, so `null` alone proves
  nothing. The proxy treats it as its own sandboxed page only when the
  Referer is this host under the same port's `/proxy|absproxy/<port>/` (or
  the port host). Only then is Origin rewritten to `http://localhost:<port>`
  (so dev servers' origin checks pass), `Sec-Fetch-Site` sent to the app as
  `same-origin` (Next blocks cross-site `/_next/*` loads),
  `Access-Control-Allow-Origin: null` added, preflights answered by the
  proxy, and null-origin WebSockets accepted. Everything else goes to the
  app as `null`, gets no CORS answer, and null-origin WebSockets get 403.

  Chrome sends that Referer for navigations and module scripts, **not**
  for `fetch`, XHR or WebSocket from a sandboxed page. So in path mode a
  page and its classic/module scripts, styles and images load, but the
  app's own `fetch`/XHR calls to itself are blocked by CORS and HMR
  sockets are refused. Use subdomain mode for SPAs and dev servers. On a
  LAN without sign-in you can opt into the old behaviour with
  `AGENTOS_PROXY_TRUST_NULL_ORIGIN=1`; then any website you visit can,
  through your browser, read and drive the apps behind the proxy past
  their own origin checks.

- With Agent-OS sign-in on, proxy paths need sign-in like every route.
- At most 256 open connections per port (503 beyond).

### What the sandbox does not cover

- It protects Agent-OS from the app, not the app from other sites: the
  app's own CSRF and origin checks still apply, and a page that sets
  `<meta name="referrer" content="no-referrer">` loses the Referer the
  proxy needs, so its CORS calls and WebSockets are refused.
- Inside the sandbox `localStorage`, `document.cookie` and IndexedDB
  throw, and the app's own `SameSite=Lax/Strict` cookies are not sent on
  its fetches (they are cross-site from an opaque origin). Apps that log
  in with cookies don't work in path mode.
- `/proxy/<port>/` strips the prefix, so apps that load assets from the
  root (`/@vite/client`, `/_next/...`, `/assets/...`) get Agent-OS's 404s
  and show a blank page. Either use subdomain mode, or configure the app's
  base and open `/absproxy/<port>/`: Vite `base: "/absproxy/5173/"`, Next
  `basePath: "/absproxy/3000"`, CRA `PUBLIC_URL=/absproxy/3000`. Apps with
  only relative URLs work in `/proxy/<port>/`.
- `AGENTOS_PROXY_SANDBOX=0` removes it; then any proxied app can drive
  Agent-OS with your rights. Don't.

### Path-mode limit behind a sign-in front door

A sandboxed page has an opaque origin, so its subresource requests
(scripts, styles, fetches) are cross-site and carry no `SameSite=Lax`
cookies, such as Authelia's. The page itself loads (it is your own
navigation), so OAuth callbacks and single-document pages work, but a
multi-file app's assets get redirected to the login. Behind Authelia, use
subdomain mode for full dev previews. On a LAN without a front door, path
mode loads pages and their assets, but not the app's own fetch/XHR or HMR
(see `Origin: null` above).

## Settings

| Env                                 | Effect                                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------ |
| `AGENTOS_PROXY=0`                   | Proxy off (also the Labs flag "Port proxy")                                                      |
| `AGENTOS_PROXY_DOMAIN=d`            | Subdomain mode on `<port>.d` (also `proxyDomain` in `$AGENT_OS_HOME/proxy.json`)                 |
| `AGENTOS_PROXY_DENY_PORTS=a,b`      | More refused ports, e.g. `8443` for code-server                                                  |
| `AGENTOS_PROXY_STRIP_COOKIES=x,y_*` | More cookies never sent to apps                                                                  |
| `AGENTOS_PROXY_SUBDOMAIN_SANDBOX=1` | Sandbox port hosts too                                                                           |
| `AGENTOS_PROXY_TRUST_NULL_ORIGIN=1` | Every `Origin: null` counts as the proxied page (fetch/XHR/HMR in path mode; see the risk above) |
| `AGENTOS_PROXY_SANDBOX=0`           | **Unsafe**: no sandbox in path mode (code-server parity; proxied apps can control Agent-OS)      |
| `AGENTOS_ORIGIN_GATE=0`             | Turns the origin gate off (escape hatch)                                                         |
| `AGENTOS_PUBLIC_URL=https://…`      | Where browser-helper links point (also `publicUrl` in `proxy.json`)                              |
| `AGENTOS_BROWSER_HELPER=0`          | Sessions don't get `BROWSER`                                                                     |

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

A `BROWSER` the session already has is kept: in the docker-code-server
image the tmux server inherits `BROWSER=/usr/local/bin/browser-helper`
(code-server's, which turns links into `CODE_SERVER_URL/proxy/<port>/`).
Set `AGENTOS_PUBLIC_URL` (or `publicUrl` in `proxy.json`) to make Agent-OS's
helper replace it. With the proxy off (flag or `AGENTOS_PROXY=0`), sessions
get no helper and the page doesn't poll for links.

The printed link uses `AGENTOS_PUBLIC_URL`, then OIDC's public URL, then
the push settings' public URL, then the address the user's own page was
last opened at (learned only from requests carrying the user-proof cookie,
never from a header any loopback caller can send). The toast always uses
the page's own address.

Sessions started before this change keep their old environment until they
are relaunched. Shell sessions opened from the page don't get `BROWSER` yet.

## Subdomain mode: what to add (not done by Agent-OS)

Each port gets its own origin (`https://5173.<domain>`), so no sandbox is
needed and everything a dev server does works (root-absolute assets, HMR,
storage, cookie logins).

### Pick the domain: a separate registrable domain is safer

A port host runs code an agent controls. If it shares a registrable domain
(eTLD+1) with your other services, it is **same-site** with all of them:

- Browsers send `SameSite=Lax/Strict` cookies (including Authelia's
  `elabx.app` session cookie) on its requests to `cleanuparr.elabx.app`,
  `komodo.elabx.app`, the arr apps and so on, so SameSite no longer
  protects those services from CSRF.
- Its JavaScript can set cookies with `Domain=elabx.app` for every service,
  including `authelia_session` (session fixation, or a cookie bomb that
  locks you out). The proxy strips `Domain` from the app's `Set-Cookie`
  headers, but it can't stop `document.cookie`.

Agent-OS itself stays safe either way (the origin gate refuses same-site
callers; permission answers need same-origin and the per-boot cookie).

Options, best first:

1. **A separate registrable domain** just for previews, e.g.
   `*.preview-elabx.app` (`AGENTOS_PROXY_DOMAIN=preview-elabx.app`), with
   its own Authelia session cookie domain. Nothing else lives there.
2. **Under `agent.elabx.app` with `AGENTOS_PROXY_SUBDOMAIN_SANDBOX=1`**:
   port hosts are sandboxed like path mode. No cookie planting, no
   same-site requests, but also the path-mode limits above (no storage,
   front-door cookies not sent on subresources, so behind Authelia only
   single-document pages work).
3. **Under `agent.elabx.app` without the sandbox**, accepting the risk
   above. Only with agents you trust as much as yourself.

### Steps (example: option 1 with `preview-elabx.app`; for options 2/3 use `agent.elabx.app`)

1. **DNS (Technitium)**: a zone `preview-elabx.app` with a wildcard record
   `*.preview-elabx.app` pointing where `agent.elabx.app` points (CNAME
   `agent.elabx.app.` or the same A record). For option 2/3: a wildcard
   `*.agent.elabx.app` in the `elabx.app` zone.
2. **TLS**: a wildcard certificate one level deep. Have Traefik's
   certResolver (DNS challenge) issue
   `tls.domains: [{ main: "preview-elabx.app", sans: ["*.preview-elabx.app"] }]`
   (`*.elabx.app` does not cover `*.agent.elabx.app` either).
3. **Traefik v3 router**, same service as `agent.elabx.app` (port 3011):
   ```yaml
   rule: HostRegexp(`^[0-9]+\.preview-elabx\.app$`)
   middlewares: [authelia@docker] # the same forward-auth as agent.elabx.app
   service: agent-os
   tls: { certResolver: <resolver> }
   ```
   Keep the Host header (Traefik's default): Agent-OS picks the port from
   `Host` only, never from `X-Forwarded-Host`.
4. **Authelia**:
   - `session.cookies`: add an entry for `preview-elabx.app` (its own
     `authelia_url`, e.g. `https://auth.preview-elabx.app`, which also
     needs DNS + a router to Authelia). You sign in once per domain.
     (Options 2/3: the existing `elabx.app` cookie covers it.)
   - `access_control`, same policy and subject as `agent.elabx.app`:
     ```yaml
     - domain_regex: '^\d+\.preview-elabx\.app$'
       policy: one_factor
       subject: ["group:<your group>"]
     ```
5. **Agent-OS**: `AGENTOS_PROXY_DOMAIN=preview-elabx.app` (or
   `proxyDomain` in `$AGENT_OS_HOME/proxy.json`), plus
   `AGENTOS_PROXY_SUBDOMAIN_SANDBOX=1` for option 2. Restart.

A port host only ever serves the app: `/api`, `/ws/terminal` and `/auth`
on it go to the app, not Agent-OS. Agent-OS's own sign-in (OIDC) does not
reach port hosts (its cookie is host-only), so with OIDC on, gate port
hosts in the front door; otherwise they answer 401 to non-loopback callers.

## Risks

- On a LAN with no sign-in anywhere, the proxy exposes every loopback-only
  service in the container to whoever can reach Agent-OS (code-server's
  proxy does too). Turn it off with the Labs flag or `AGENTOS_PROXY=0`.
- Any process in the container, agents included, can raise a link toast;
  it is rate-limited and always shows the host and the session.
- Consider `AGENTOS_PROXY_DENY_PORTS=8443` so code-server isn't reachable
  through Agent-OS.
