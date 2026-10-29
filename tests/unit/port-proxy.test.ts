import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  isRefusedPort,
  matchProxyHost,
  normaliseBase,
  parsePortList,
  parseProxyPath,
} from "../../lib/port-proxy-target";
import {
  DEFAULT_STRIPPED_COOKIES,
  MAX_SET_COOKIES,
  SANDBOX_CSP,
  downstreamResponseHeaders,
  fromProxiedPage,
  parseHead,
  rewriteLocation,
  rewriteSetCookie,
  sandboxPreflightHeaders,
  serializeHead,
  stripCookieHeader,
  upstreamRequestHeaders,
  type RequestContext,
  type ResponseContext,
} from "../../lib/port-proxy-headers";

describe("parseProxyPath", () => {
  test("proxy strips the prefix, absproxy keeps it, query kept", () => {
    assert.deepEqual(parseProxyPath("/proxy/5173/src/main.ts?t=1"), {
      kind: "ok",
      mode: "proxy",
      port: 5173,
      upstreamPath: "/src/main.ts?t=1",
      prefix: "/proxy/5173",
    });
    assert.deepEqual(parseProxyPath("/absproxy/5173/x/echo?a=b"), {
      kind: "ok",
      mode: "absproxy",
      port: 5173,
      upstreamPath: "/absproxy/5173/x/echo?a=b",
      prefix: "/absproxy/5173",
    });
    const root = parseProxyPath("/proxy/80/");
    assert.equal(root?.kind === "ok" && root.upstreamPath, "/");
  });

  test("percent-encoding is forwarded byte for byte", () => {
    const parsed = parseProxyPath("/proxy/3000/a%20b/%E2%9C%93?q=%2F");
    assert.equal(
      parsed?.kind === "ok" && parsed.upstreamPath,
      "/a%20b/%E2%9C%93?q=%2F"
    );
  });

  test("no trailing slash redirects, keeping the query", () => {
    assert.deepEqual(parseProxyPath("/proxy/5173"), {
      kind: "redirect",
      location: "/proxy/5173/",
    });
    assert.deepEqual(parseProxyPath("/absproxy/5173?x=1"), {
      kind: "redirect",
      location: "/absproxy/5173/?x=1",
    });
  });

  test("bad ports and dot segments are refused", () => {
    for (const url of [
      "/proxy/0/",
      "/proxy/65536/",
      "/proxy/70000/",
      "/proxy/abc/",
      "/proxy/+1/",
      "/proxy/-1/",
      "/proxy/123456/",
      "/proxy//",
    ]) {
      assert.equal(parseProxyPath(url)?.kind, "bad", url);
    }
    for (const url of [
      "/proxy/80/../api/sessions",
      "/proxy/80/a/%2e%2e/b",
      "/proxy/80/%2E%2E/",
      "/proxy/80/a%2f..%2fb",
      "/proxy/80/%zz",
    ]) {
      assert.equal(parseProxyPath(url)?.kind, "bad", url);
    }
    // ".." in the query is the app's business
    assert.equal(parseProxyPath("/proxy/80/a?p=../x")?.kind, "ok");
  });

  test("other paths are not proxy paths", () => {
    for (const url of [
      "/",
      "/proxy",
      "/proxyx/80/",
      "/api/proxy/80/",
      "/proxy-80/",
    ]) {
      assert.equal(parseProxyPath(url), null, url);
    }
  });
});

describe("matchProxyHost", () => {
  test("matches <port>.<base>, case and port insensitive", () => {
    assert.equal(
      matchProxyHost("5173.agent.elabx.app", "agent.elabx.app"),
      5173
    );
    assert.equal(
      matchProxyHost("5173.Agent.ELABX.app:443", "agent.elabx.app"),
      5173
    );
    assert.equal(
      matchProxyHost("5173.agent.elabx.app", "https://agent.elabx.app/"),
      5173
    );
  });

  test("anything else is not a port host", () => {
    assert.equal(
      matchProxyHost("x.5173.agent.elabx.app", "agent.elabx.app"),
      null
    );
    assert.equal(matchProxyHost("agent.elabx.app", "agent.elabx.app"), null);
    assert.equal(matchProxyHost("0.agent.elabx.app", "agent.elabx.app"), null);
    assert.equal(
      matchProxyHost("99999.agent.elabx.app", "agent.elabx.app"),
      null
    );
    assert.equal(
      matchProxyHost("5173.evilagent.elabx.app", "agent.elabx.app"),
      null
    );
    assert.equal(matchProxyHost("5173.agent.elabx.app", null), null);
    assert.equal(matchProxyHost("5173.agent.elabx.app", ""), null);
    assert.equal(matchProxyHost(undefined, "agent.elabx.app"), null);
  });

  test("normaliseBase", () => {
    assert.equal(
      normaliseBase(" .Agent.Example.com:8443/x "),
      "agent.example.com"
    );
    assert.equal(normaliseBase(""), null);
    assert.equal(normaliseBase(undefined), null);
  });
});

describe("isRefusedPort", () => {
  const config = { ownPort: 3112, deny: [8443] };
  test("Agent-OS itself, the live port and the deny list", () => {
    assert.ok(isRefusedPort(3112, config));
    assert.ok(isRefusedPort(3011, config));
    assert.ok(isRefusedPort(8443, config));
    assert.ok(isRefusedPort(0, config));
    assert.ok(isRefusedPort(65536, config));
    assert.ok(isRefusedPort(1.5, config));
    assert.ok(!isRefusedPort(5173, config));
  });
  test("parsePortList", () => {
    assert.deepEqual(parsePortList("8443, 9000,x,0,70000"), [8443, 9000]);
    assert.deepEqual(parsePortList(undefined), []);
  });
});

const raw = (headers: [string, string][]) => headers.flat();

const reqCtx = (extra: Partial<RequestContext> = {}): RequestContext => ({
  port: 5173,
  mode: "proxy",
  prefix: "/proxy/5173",
  publicHost: "agent.example.com",
  proto: "https",
  clientAddress: "10.0.0.9",
  strippedCookies: [...DEFAULT_STRIPPED_COOKIES, "custom", "pre_*"],
  ...extra,
});

describe("upstreamRequestHeaders", () => {
  test("strips Agent-OS and front-door cookies, keeps the app's", () => {
    const out = upstreamRequestHeaders(
      raw([
        ["Cookie", "agentos_u=s; app=1; agentos_session=x; authelia_session=y"],
        ["Cookie", "agentos_login=a; agentos_px=b; custom=1; pre_x=2; keep=3"],
      ]),
      reqCtx()
    );
    assert.equal(out["cookie"], "app=1; keep=3");
  });

  test("drops the cookie header when nothing is left", () => {
    const out = upstreamRequestHeaders(
      raw([["Cookie", "agentos_u=s; authelia_session=y"]]),
      reqCtx()
    );
    assert.equal(out["cookie"], undefined);
  });

  test("drops identity, hop-by-hop and Connection-listed headers", () => {
    const out = upstreamRequestHeaders(
      raw([
        ["Authorization", "Bearer x"],
        ["X-Agentos-Origin", "agent"],
        ["Remote-User", "me"],
        ["Remote-Groups", "admins"],
        ["Remote-Name", "Me"],
        ["Remote-Email", "me@x"],
        ["Connection", "keep-alive, X-Secret"],
        ["X-Secret", "1"],
        ["Keep-Alive", "timeout=5"],
        ["TE", "trailers"],
        ["Upgrade", "h2c"],
        ["Proxy-Authorization", "x"],
        ["Accept-Encoding", "gzip, br"],
        ["X-Custom", "ok"],
      ]),
      reqCtx()
    );
    for (const name of [
      "authorization",
      "x-agentos-origin",
      "remote-user",
      "remote-groups",
      "remote-name",
      "remote-email",
      "connection",
      "x-secret",
      "keep-alive",
      "te",
      "upgrade",
      "proxy-authorization",
    ]) {
      assert.equal(out[name], undefined, name);
    }
    assert.equal(out["accept-encoding"], "gzip, br");
    assert.equal(out["x-custom"], "ok");
  });

  test("Host, Origin, Referer and X-Forwarded-*", () => {
    const out = upstreamRequestHeaders(
      raw([
        ["Host", "agent.example.com"],
        ["Origin", "https://agent.example.com"],
        ["Referer", "https://agent.example.com/proxy/5173/page?x=1"],
        ["X-Forwarded-For", "1.2.3.4"],
        ["X-Forwarded-Proto", "https"],
        ["X-Forwarded-Host", "spoof"],
        ["X-Forwarded-Port", "443"],
        ["X-Real-IP", "6.6.6.6"],
      ]),
      reqCtx()
    );
    assert.equal(out["host"], "localhost:5173");
    assert.equal(out["origin"], "http://localhost:5173");
    assert.equal(out["referer"], "http://localhost:5173/page?x=1");
    assert.equal(out["x-forwarded-for"], "1.2.3.4, 10.0.0.9");
    assert.equal(out["x-forwarded-host"], "agent.example.com");
    assert.equal(out["x-forwarded-proto"], "https");
    assert.equal(out["x-forwarded-prefix"], "/proxy/5173");
    assert.equal(out["x-forwarded-port"], undefined);
    assert.equal(out["x-real-ip"], "10.0.0.9");
  });

  test("Origin null becomes the app's origin only from our own page", () => {
    const sandboxed = upstreamRequestHeaders(
      raw([["Origin", "null"]]),
      reqCtx({ ownPage: true })
    );
    assert.equal(sandboxed["origin"], "http://localhost:5173");
    // Another site's sandboxed iframe: "null" goes to the app as is
    const other = upstreamRequestHeaders(
      raw([
        ["Origin", "null"],
        ["Referer", "https://evil.example/"],
      ]),
      reqCtx()
    );
    assert.equal(other["origin"], "null");
    const foreign = upstreamRequestHeaders(
      raw([["Origin", "https://evil.example"]]),
      reqCtx()
    );
    assert.equal(foreign["origin"], "https://evil.example");
  });

  test("Sec-Fetch-Site is same-origin for our own page only", () => {
    const own = upstreamRequestHeaders(
      raw([
        ["Sec-Fetch-Site", "cross-site"],
        ["Sec-Fetch-Mode", "no-cors"],
      ]),
      reqCtx({ ownPage: true })
    );
    assert.equal(own["sec-fetch-site"], "same-origin");
    assert.equal(own["sec-fetch-mode"], "no-cors");
    const other = upstreamRequestHeaders(
      raw([["Sec-Fetch-Site", "cross-site"]]),
      reqCtx()
    );
    assert.equal(other["sec-fetch-site"], "cross-site");
  });

  test("fromProxiedPage: Referer on this host under this port", () => {
    const at = (referer: string | undefined, mode = "proxy" as const) =>
      fromProxiedPage(referer ? { referer } : {}, {
        port: 5173,
        mode,
        publicHost: "agent.example.com",
      });
    assert.ok(at("https://agent.example.com/proxy/5173/"));
    assert.ok(at("https://agent.example.com/proxy/5173"));
    assert.ok(at("https://agent.example.com/absproxy/5173/a?b"));
    assert.ok(!at("https://agent.example.com/proxy/51730/"));
    assert.ok(!at("https://agent.example.com/proxy/3000/"));
    assert.ok(!at("https://agent.example.com/"));
    assert.ok(!at("https://evil.example/proxy/5173/"));
    assert.ok(!at(undefined));
    assert.ok(!at("garbage"));
    assert.ok(
      fromProxiedPage(
        { referer: "https://5173.agent.example.com/x" },
        { port: 5173, mode: "subdomain", publicHost: "5173.agent.example.com" }
      )
    );
  });

  test("absproxy keeps the Referer path; subdomain has no prefix", () => {
    const abs = upstreamRequestHeaders(
      raw([["Referer", "https://agent.example.com/absproxy/5173/a"]]),
      reqCtx({ mode: "absproxy", prefix: "/absproxy/5173" })
    );
    assert.equal(abs["referer"], "http://localhost:5173/absproxy/5173/a");
    const sub = upstreamRequestHeaders(
      raw([["Host", "5173.agent.example.com"]]),
      reqCtx({
        mode: "subdomain",
        prefix: "",
        publicHost: "5173.agent.example.com",
      })
    );
    assert.equal(sub["x-forwarded-prefix"], undefined);
    assert.equal(sub["x-forwarded-host"], "5173.agent.example.com");
    assert.equal(sub["x-forwarded-proto"], "https");
  });

  test("upgrades keep Connection, Upgrade and Sec-WebSocket-*", () => {
    const out = upstreamRequestHeaders(
      raw([
        ["Connection", "Upgrade"],
        ["Upgrade", "websocket"],
        ["Sec-WebSocket-Key", "abc"],
        ["Sec-WebSocket-Version", "13"],
      ]),
      reqCtx({ upgrade: true })
    );
    assert.equal(out["connection"], "Upgrade");
    assert.equal(out["upgrade"], "websocket");
    assert.equal(out["sec-websocket-key"], "abc");
  });
});

const resCtx = (extra: Partial<ResponseContext> = {}): ResponseContext => ({
  port: 5173,
  mode: "proxy",
  prefix: "/proxy/5173",
  subdomainBase: "agent.example.com",
  proto: "https",
  sandbox: true,
  strippedCookies: DEFAULT_STRIPPED_COOKIES,
  ...extra,
});

describe("rewriteLocation", () => {
  const proxy = resCtx();
  const abs = resCtx({ mode: "absproxy", prefix: "/absproxy/5173" });
  const sub = resCtx({ mode: "subdomain", prefix: "", sandbox: false });

  test("loopback URLs on any port go through the proxy", () => {
    assert.equal(
      rewriteLocation("http://localhost:5173/echo?a=1", proxy),
      "/proxy/5173/echo?a=1"
    );
    assert.equal(
      rewriteLocation("http://127.0.0.1:4000/x", proxy),
      "/proxy/4000/x"
    );
    assert.equal(rewriteLocation("http://[::1]:5173/", proxy), "/proxy/5173/");
    assert.equal(rewriteLocation("http://0.0.0.0:5173", proxy), "/proxy/5173/");
    assert.equal(
      rewriteLocation("https://localhost:8443/a#h", proxy),
      "/proxy/8443/a#h"
    );
    assert.equal(
      rewriteLocation("http://LOCALHOST:5173/x", proxy),
      "/proxy/5173/x"
    );
  });

  test("absproxy prefixes once", () => {
    assert.equal(
      rewriteLocation("http://localhost:5173/echo", abs),
      "/absproxy/5173/echo"
    );
    assert.equal(
      rewriteLocation("http://localhost:5173/absproxy/5173/echo", abs),
      "/absproxy/5173/echo"
    );
    assert.equal(rewriteLocation("/absproxy/5173/x", abs), "/absproxy/5173/x");
  });

  test("subdomain goes to the port host", () => {
    assert.equal(
      rewriteLocation("http://localhost:4000/x?y", sub),
      "https://4000.agent.example.com/x?y"
    );
    assert.equal(rewriteLocation("/x", sub), "/x");
  });

  test("root-relative stays under the prefix; others unchanged", () => {
    assert.equal(rewriteLocation("/echo", proxy), "/proxy/5173/echo");
    // Apps that honour X-Forwarded-Prefix add it themselves: not twice
    assert.equal(
      rewriteLocation("/proxy/5173/login", proxy),
      "/proxy/5173/login"
    );
    assert.equal(rewriteLocation("/proxy/5173", proxy), "/proxy/5173");
    assert.equal(rewriteLocation("/proxy/5173?a=1", proxy), "/proxy/5173?a=1");
    assert.equal(
      rewriteLocation("/proxy/51730/x", proxy),
      "/proxy/5173/proxy/51730/x"
    );
    assert.equal(rewriteLocation("echo", proxy), "echo");
    assert.equal(rewriteLocation("../x", proxy), "../x");
    assert.equal(
      rewriteLocation("//evil.example/x", proxy),
      "//evil.example/x"
    );
    assert.equal(rewriteLocation("/\\evil.example", proxy), "/\\evil.example");
    assert.equal(
      rewriteLocation("https://accounts.example.com/o?redirect_uri=x", proxy),
      "https://accounts.example.com/o?redirect_uri=x"
    );
    assert.equal(
      rewriteLocation("http://localhost/x", proxy),
      "http://localhost/x"
    );
  });
});

describe("rewriteSetCookie", () => {
  test("drops Agent-OS, front-door and prefixed names", () => {
    const ctx = resCtx();
    assert.equal(rewriteSetCookie("agentos_u=evil; Path=/", ctx), null);
    assert.equal(rewriteSetCookie("agentos_session=x", ctx), null);
    assert.equal(
      rewriteSetCookie("authelia_session=x; Domain=example.com", ctx),
      null
    );
    assert.equal(rewriteSetCookie("__Host-id=1; Path=/; Secure", ctx), null);
    assert.equal(rewriteSetCookie("__Secure-id=1; Secure", ctx), null);
  });

  test("strips Domain and puts the cookie under the prefix", () => {
    const ctx = resCtx();
    assert.equal(
      rewriteSetCookie(
        "app=1; Path=/; HttpOnly; Domain=agent.example.com",
        ctx
      ),
      "app=1; Path=/proxy/5173/; HttpOnly"
    );
    assert.equal(rewriteSetCookie("x=1", ctx), "x=1; Path=/proxy/5173/");
    assert.equal(
      rewriteSetCookie("x=1; path=/api; SameSite=Lax", ctx),
      "x=1; Path=/proxy/5173/api; SameSite=Lax"
    );
  });

  test("absproxy keeps paths under the prefix, forces the rest under it", () => {
    const abs = resCtx({ mode: "absproxy", prefix: "/absproxy/5173" });
    assert.equal(
      rewriteSetCookie("x=1; Path=/absproxy/5173/; Domain=x", abs),
      "x=1; Path=/absproxy/5173/"
    );
    assert.equal(
      rewriteSetCookie("x=1; Path=/absproxy/5173/app", abs),
      "x=1; Path=/absproxy/5173/app"
    );
    assert.equal(
      rewriteSetCookie("x=1; Path=/absproxy/5173", abs),
      "x=1; Path=/absproxy/5173"
    );
    // A cookie bomb on Agent-OS's paths stays inside the app's prefix
    assert.equal(
      rewriteSetCookie("big=1; Path=/; Max-Age=999", abs),
      "big=1; Path=/absproxy/5173/; Max-Age=999"
    );
    assert.equal(
      rewriteSetCookie("x=1; Path=/api", abs),
      "x=1; Path=/absproxy/5173/"
    );
    assert.equal(
      rewriteSetCookie("x=1; Path=/absproxy/51730/", abs),
      "x=1; Path=/absproxy/5173/"
    );
    assert.equal(rewriteSetCookie("x=1", abs), "x=1; Path=/absproxy/5173/");
  });

  test("oversized cookies and too many per response are dropped", () => {
    const ctx = resCtx();
    assert.equal(rewriteSetCookie(`x=${"a".repeat(5000)}`, ctx), null);
    const many = Array.from({ length: MAX_SET_COOKIES + 10 }, (_, i) => [
      "Set-Cookie",
      `c${i}=1`,
    ]) as [string, string][];
    const out = downstreamResponseHeaders(raw(many), ctx);
    assert.equal((out["set-cookie"] as string[]).length, MAX_SET_COOKIES);
  });

  test("subdomain keeps the path", () => {
    assert.equal(
      rewriteSetCookie(
        "x=1; Domain=agent.example.com",
        resCtx({ mode: "subdomain", prefix: "" })
      ),
      "x=1"
    );
  });
});

describe("downstreamResponseHeaders", () => {
  test("drops origin-wide headers, adds the sandbox beside the app's CSP", () => {
    const out = downstreamResponseHeaders(
      raw([
        ["Content-Type", "text/html"],
        ["Content-Encoding", "gzip"],
        ["Content-Length", "123"],
        ["Strict-Transport-Security", "max-age=1"],
        ["Clear-Site-Data", '"*"'],
        ["Alt-Svc", "h3"],
        ["Service-Worker-Allowed", "/"],
        ["Content-Security-Policy", "default-src 'self'"],
        ["Content-Security-Policy-Report-Only", "img-src 'none'"],
        ["Transfer-Encoding", "chunked"],
        ["Connection", "close"],
        ["Set-Cookie", "agentos_u=evil"],
        ["Set-Cookie", "app=1; Path=/"],
        ["Location", "http://localhost:5173/next"],
      ]),
      resCtx()
    );
    assert.equal(out["strict-transport-security"], undefined);
    assert.equal(out["clear-site-data"], undefined);
    assert.equal(out["alt-svc"], undefined);
    assert.equal(out["service-worker-allowed"], undefined);
    assert.equal(out["transfer-encoding"], undefined);
    assert.equal(out["connection"], undefined);
    assert.equal(out["content-encoding"], "gzip");
    assert.equal(out["content-length"], "123");
    assert.deepEqual(out["content-security-policy"], [
      "default-src 'self'",
      SANDBOX_CSP,
    ]);
    assert.equal(out["content-security-policy-report-only"], "img-src 'none'");
    assert.equal(out["set-cookie"], "app=1; Path=/proxy/5173/");
    assert.equal(out["location"], "/proxy/5173/next");
    assert.equal(out["x-agentos-proxy"], "5173");
  });

  test("the sandbox never allows same-origin, top navigation or escapes", () => {
    assert.match(SANDBOX_CSP, /^sandbox /);
    assert.doesNotMatch(
      SANDBOX_CSP,
      /allow-same-origin|allow-top-navigation|escape-sandbox/
    );
  });

  test("every response is sandboxed, not just HTML", () => {
    const out = downstreamResponseHeaders(
      raw([["Content-Type", "image/svg+xml"]]),
      resCtx()
    );
    assert.equal(out["content-security-policy"], SANDBOX_CSP);
  });

  test("ACAO null only for our own page's Origin null, only when absent", () => {
    const sandboxed = downstreamResponseHeaders(
      [],
      resCtx({ requestOrigin: "null", ownPage: true })
    );
    assert.equal(sandboxed["access-control-allow-origin"], "null");
    assert.equal(sandboxed["access-control-allow-credentials"], undefined);
    // Someone else's sandboxed iframe can't read the app's answers
    const other = downstreamResponseHeaders(
      [],
      resCtx({ requestOrigin: "null" })
    );
    assert.equal(other["access-control-allow-origin"], undefined);
    const own = downstreamResponseHeaders(
      raw([["Access-Control-Allow-Origin", "*"]]),
      resCtx({ requestOrigin: "null", ownPage: true })
    );
    assert.equal(own["access-control-allow-origin"], "*");
    const normal = downstreamResponseHeaders(
      [],
      resCtx({ requestOrigin: "https://agent.example.com" })
    );
    assert.equal(normal["access-control-allow-origin"], undefined);
  });

  test("subdomain mode: no sandbox, no ACAO null", () => {
    const out = downstreamResponseHeaders(
      raw([["Content-Type", "text/html"]]),
      resCtx({
        mode: "subdomain",
        prefix: "",
        sandbox: false,
        requestOrigin: "null",
      })
    );
    assert.equal(out["content-security-policy"], undefined);
    assert.equal(out["access-control-allow-origin"], undefined);
  });

  test("101 answers keep the upgrade headers but still lose cookies", () => {
    const out = downstreamResponseHeaders(
      raw([
        ["Upgrade", "websocket"],
        ["Connection", "Upgrade"],
        ["Sec-WebSocket-Accept", "x"],
        ["Set-Cookie", "agentos_u=evil"],
        ["Strict-Transport-Security", "max-age=1"],
      ]),
      resCtx({ upgrade: true })
    );
    assert.equal(out["upgrade"], "websocket");
    assert.equal(out["connection"], "Upgrade");
    assert.equal(out["sec-websocket-accept"], "x");
    assert.equal(out["set-cookie"], undefined);
    assert.equal(out["strict-transport-security"], undefined);
  });
});

describe("helpers", () => {
  test("stripCookieHeader", () => {
    assert.equal(
      stripCookieHeader("a=1;agentos_x=2; b=3", ["agentos_*"]),
      "a=1; b=3"
    );
    assert.equal(stripCookieHeader("", ["agentos_*"]), null);
  });

  test("sandboxPreflightHeaders echoes the request", () => {
    const out = sandboxPreflightHeaders("PUT", "content-type");
    assert.equal(out["access-control-allow-origin"], "null");
    assert.equal(out["access-control-allow-methods"], "PUT");
    assert.equal(out["access-control-allow-headers"], "content-type");
  });

  test("serializeHead and parseHead round-trip; CRLF can't be injected", () => {
    const head = serializeHead("HTTP/1.1 101 Switching Protocols", {
      upgrade: "websocket",
      "set-cookie": ["a=1", "b=2"],
      bad: "x\r\nInjected: 1",
    });
    assert.equal(
      head,
      "HTTP/1.1 101 Switching Protocols\r\nupgrade: websocket\r\nset-cookie: a=1\r\nset-cookie: b=2\r\n\r\n"
    );
    const parsed = parseHead(head.slice(0, -4));
    assert.deepEqual(parsed, {
      statusLine: "HTTP/1.1 101 Switching Protocols",
      rawHeaders: [
        "upgrade",
        "websocket",
        "set-cookie",
        "a=1",
        "set-cookie",
        "b=2",
      ],
    });
    assert.equal(parseHead("garbage"), null);
  });
});
