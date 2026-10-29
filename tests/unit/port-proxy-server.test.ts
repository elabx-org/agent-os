import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { WebSocket, WebSocketServer } from "ws";

// The proxy reads the portProxy flag from the DB: a throwaway one
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-proxy-"));
process.env.DB_PATH = path.join(tmp, "test.db");
process.env.AGENT_OS_HOME = path.join(tmp, "home");
for (const key of [
  "OIDC_ISSUER",
  "OIDC_CLIENT_ID",
  "OIDC_CLIENT_SECRET",
  "AGENT_OS_PUBLIC_URL",
  "AUTH_SECRET",
  "AGENTOS_PROXY",
  "AGENTOS_PROXY_DOMAIN",
  "AGENTOS_PROXY_SANDBOX",
  "AGENTOS_ORIGIN_GATE",
]) {
  delete process.env[key];
}

let proxy: typeof import("../../lib/port-proxy");
let gate: typeof import("../../lib/origin-gate");
let upstream: http.Server;
let front: http.Server;
let upstreamPort: number;
let frontPort: number;
const seen: { path: string; headers: http.IncomingHttpHeaders }[] = [];

const listen = (server: http.Server) =>
  new Promise<number>((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve((server.address() as net.AddressInfo).port)
    )
  );

before(async () => {
  const log = console.log;
  console.log = () => {};
  try {
    (await import("../../lib/db")).getDb();
  } finally {
    console.log = log;
  }
  proxy = await import("../../lib/port-proxy");
  gate = await import("../../lib/origin-gate");

  upstream = http.createServer((req, res) => {
    seen.push({ path: req.url ?? "", headers: req.headers });
    // An absproxy app is served under its prefix
    const url = (req.url ?? "/").replace(/^\/absproxy\/\d+/, "");
    if (url.startsWith("/echo")) {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Security-Policy": "default-src 'self'",
        "Set-Cookie": ["app=1; Path=/", "agentos_u=evil; Path=/"],
        "Strict-Transport-Security": "max-age=100",
      });
      res.end(JSON.stringify({ path: req.url, headers: req.headers }));
    } else if (url === "/redir-abs") {
      res.writeHead(302, { Location: `http://localhost:${upstreamPort}/echo` });
      res.end();
    } else if (url === "/redir-root") {
      res.writeHead(302, { Location: "/echo" });
      res.end();
    } else if (url === "/stream") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.write("one\n");
      setTimeout(() => res.end("two\n"), 300);
    } else if (url === "/gz") {
      const body = zlib.gzipSync("hello hello hello");
      res.writeHead(200, {
        "Content-Encoding": "gzip",
        "Content-Length": body.length,
      });
      res.end(body);
    } else if (url === "/post") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => res.end(`got ${body}`));
    } else {
      res.writeHead(404);
      res.end("nope");
    }
  });
  const wss = new WebSocketServer({ noServer: true });
  wss.on("headers", (headers) => {
    headers.push("Set-Cookie: agentos_u=evil");
  });
  upstream.on("upgrade", (req, socket, head) => {
    seen.push({ path: req.url ?? "", headers: req.headers });
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.send(JSON.stringify({ type: "connected" }));
      ws.on("message", (m) => ws.send(`echo:${m}`));
    });
  });
  upstreamPort = await listen(upstream);

  // The front door: server.ts's order, minus Next and sign-in
  front = http.createServer(async (req, res) => {
    const url = new URL(req.url!, "http://localhost");
    if (await proxy.proxyRequest(req, res, url, "host")) return;
    if (gate.applyOriginGate(req, res)) return;
    if (await proxy.proxyRequest(req, res, url, "path")) return;
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("agent-os");
  });
  front.on("upgrade", (req, socket, head) => {
    if (proxy.proxyUpgrade(req, socket, head, "host")) return;
    if (proxy.proxyUpgrade(req, socket, head, "path")) return;
    socket.end("HTTP/1.1 404 Not Found\r\n\r\n");
  });
  frontPort = await listen(front);
  process.env.PORT = String(frontPort);
});

after(() => {
  upstream.closeAllConnections();
  front.closeAllConnections();
  upstream.close();
  front.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

interface Got {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  chunksAt: number[];
}

function get(
  p: string,
  headers: Record<string, string> = {},
  method = "GET",
  body?: string
): Promise<Got> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const req = http.request(
      { host: "127.0.0.1", port: frontPort, path: p, method, headers },
      (res) => {
        const chunks: Buffer[] = [];
        const chunksAt: number[] = [];
        res.on("data", (c) => {
          chunks.push(c);
          chunksAt.push(Date.now() - start);
        });
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
            chunksAt,
          })
        );
      }
    );
    req.on("error", reject);
    req.end(body);
  });
}

const freePort = async () => {
  const server = net.createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise((r) => server.close(r));
  return port;
};

describe("path mode", () => {
  test("strips the prefix and sets the forwarding headers", async () => {
    const res = await get(`/proxy/${upstreamPort}/echo?x=1`, {
      Host: "agent.example.com",
      Cookie: "agentos_u=secret; app=1; authelia_session=s",
      Authorization: "Bearer x",
    });
    assert.equal(res.status, 200);
    const echo = JSON.parse(res.body.toString());
    assert.equal(echo.path, "/echo?x=1");
    assert.equal(echo.headers.host, `localhost:${upstreamPort}`);
    assert.equal(echo.headers.cookie, "app=1");
    assert.equal(echo.headers.authorization, undefined);
    assert.equal(echo.headers["x-forwarded-prefix"], `/proxy/${upstreamPort}`);
    assert.equal(echo.headers["x-forwarded-host"], "agent.example.com");
    assert.equal(echo.headers["x-forwarded-proto"], "http");
    // Both policies: the app's and the sandbox
    const csp = res.headers["content-security-policy"] as unknown as string;
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /sandbox allow-scripts/);
    assert.deepEqual(res.headers["set-cookie"], [
      `app=1; Path=/proxy/${upstreamPort}/`,
    ]);
    assert.equal(res.headers["strict-transport-security"], undefined);
  });

  test("absproxy keeps the path; no slash redirects", async () => {
    const abs = await get(`/absproxy/${upstreamPort}/echo`);
    assert.equal(
      JSON.parse(abs.body.toString()).path,
      "/absproxy/" + upstreamPort + "/echo"
    );
    const redirect = await get(`/proxy/${upstreamPort}`);
    assert.equal(redirect.status, 308);
    assert.equal(redirect.headers.location, `/proxy/${upstreamPort}/`);
  });

  test("redirects stay under the proxy", async () => {
    const abs = await get(`/proxy/${upstreamPort}/redir-abs`);
    assert.equal(abs.headers.location, `/proxy/${upstreamPort}/echo`);
    const root = await get(`/proxy/${upstreamPort}/redir-root`);
    assert.equal(root.headers.location, `/proxy/${upstreamPort}/echo`);
  });

  test("streams without buffering; compressed bytes pass through", async () => {
    const stream = await get(`/proxy/${upstreamPort}/stream`);
    assert.equal(stream.body.toString(), "one\ntwo\n");
    assert.ok(stream.chunksAt.length >= 2, "two chunks");
    assert.ok(
      stream.chunksAt[1] - stream.chunksAt[0] >= 200,
      "second chunk later"
    );
    const gz = await get(`/proxy/${upstreamPort}/gz`, {
      "Accept-Encoding": "gzip",
    });
    assert.equal(gz.headers["content-encoding"], "gzip");
    assert.equal(zlib.gunzipSync(gz.body).toString(), "hello hello hello");
  });

  test("request bodies reach the app", async () => {
    const res = await get(`/proxy/${upstreamPort}/post`, {}, "POST", "payload");
    assert.equal(res.body.toString(), "got payload");
  });

  test("nothing listening: 502 page", async () => {
    const port = await freePort();
    const html = await get(`/proxy/${port}/`, { Accept: "text/html" });
    assert.equal(html.status, 502);
    assert.match(
      html.body.toString(),
      new RegExp(`Nothing is listening on port ${port}`)
    );
    assert.match(html.body.toString(), /http-equiv="refresh"/);
    const plain = await get(`/proxy/${port}/x`);
    assert.equal(plain.status, 502);
    assert.equal(plain.headers["content-type"], "text/plain; charset=utf-8");
  });

  test("refused and bad ports", async () => {
    assert.equal((await get(`/proxy/${frontPort}/`)).status, 403);
    assert.equal((await get("/proxy/3011/")).status, 403);
    assert.equal((await get("/proxy/70000/")).status, 400);
    assert.equal((await get(`/proxy/${upstreamPort}/a/%2e%2e/b`)).status, 400);
  });

  test("sandboxed preflight the app can't answer gets a null CORS answer", async () => {
    const res = await get(
      `/proxy/${upstreamPort}/nothing`,
      {
        Origin: "null",
        "Access-Control-Request-Method": "PUT",
        "Access-Control-Request-Headers": "content-type",
      },
      "OPTIONS"
    );
    assert.equal(res.status, 204);
    assert.equal(res.headers["access-control-allow-origin"], "null");
    assert.equal(res.headers["access-control-allow-headers"], "content-type");
  });

  test("AGENTOS_PROXY=0: as if it didn't exist", async () => {
    process.env.AGENTOS_PROXY = "0";
    try {
      const res = await get(`/proxy/${upstreamPort}/echo`);
      assert.equal(res.body.toString(), "agent-os");
    } finally {
      delete process.env.AGENTOS_PROXY;
    }
  });
});

describe("origin gate in front of Agent-OS", () => {
  test("a sandboxed page's API call is refused; plain callers pass", async () => {
    const refused = await get(
      "/api/sessions/s/send-keys",
      { Origin: "null" },
      "POST"
    );
    assert.equal(refused.status, 403);
    assert.equal(JSON.parse(refused.body.toString()).reason, "opaque_origin");
    const referer = await get("/api/sessions", {
      Referer: `http://127.0.0.1:${frontPort}/proxy/${upstreamPort}/page`,
    });
    assert.equal(referer.status, 403);
    assert.equal((await get("/api/sessions")).body.toString(), "agent-os");
  });
});

function openWs(
  url: string,
  headers: Record<string, string> = {}
): Promise<{ ws: WebSocket; first: string; cookies: string[] }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    let cookies: string[] = [];
    ws.on("upgrade", (res) => {
      const raw = res.headers["set-cookie"];
      cookies = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
    });
    ws.once("message", (m) => resolve({ ws, first: m.toString(), cookies }));
    ws.once("unexpected-response", (_req, res) =>
      reject(new Error(`status ${res.statusCode}`))
    );
    ws.once("error", reject);
  });
}

describe("WebSocket upgrades", () => {
  test("HMR-style socket through /proxy, cookies filtered", async () => {
    const { ws, first, cookies } = await openWs(
      `ws://127.0.0.1:${frontPort}/proxy/${upstreamPort}/ws`,
      { Origin: `http://127.0.0.1:${frontPort}` }
    );
    assert.equal(first, JSON.stringify({ type: "connected" }));
    assert.deepEqual(cookies, []);
    const echo = new Promise<string>((r) =>
      ws.once("message", (m) => r(m.toString()))
    );
    ws.send("ping");
    assert.equal(await echo, "echo:ping");
    ws.close();
    const upgrade = seen.filter((s) => s.path === "/ws").at(-1)!;
    assert.equal(upgrade.headers.origin, `http://localhost:${upstreamPort}`);
  });

  test("the sandboxed page (Origin null) may connect; foreign origins can't", async () => {
    const { ws } = await openWs(
      `ws://127.0.0.1:${frontPort}/proxy/${upstreamPort}/ws`,
      { Origin: "null" }
    );
    ws.close();
    await assert.rejects(
      openWs(`ws://127.0.0.1:${frontPort}/proxy/${upstreamPort}/ws`, {
        Origin: "http://evil.example",
      }),
      /status 403/
    );
    await assert.rejects(
      openWs(`ws://127.0.0.1:${frontPort}/proxy/${frontPort}/ws`),
      /status 403/
    );
  });
});

describe("subdomain mode", () => {
  test("the whole port host is the app, unsandboxed", async () => {
    process.env.AGENTOS_PROXY_DOMAIN = "agent.test";
    try {
      const host = `${upstreamPort}.agent.test`;
      const res = await get("/echo", { Host: host });
      const echo = JSON.parse(res.body.toString());
      assert.equal(echo.path, "/echo");
      assert.equal(
        res.headers["content-security-policy"],
        "default-src 'self'"
      );
      assert.deepEqual(res.headers["set-cookie"], ["app=1; Path=/"]);
      // Agent-OS's own paths on a port host go to the app too
      const api = await get("/api/sessions", { Host: host });
      assert.equal(api.status, 404);
      assert.equal(api.body.toString(), "nope");
      const redirect = await get("/redir-abs", { Host: host });
      assert.equal(
        redirect.headers.location,
        `http://${upstreamPort}.agent.test/echo`
      );
      // A port host page calling Agent-OS is refused by the gate
      const call = await get(
        "/api/sessions/s/send-keys",
        {
          Host: "agent.test",
          Origin: `http://${host}`,
        },
        "POST"
      );
      assert.equal(call.status, 403);
      const { ws, first } = await openWs(`ws://127.0.0.1:${frontPort}/ws`, {
        Host: host,
        Origin: `http://${host}`,
      });
      assert.equal(first, JSON.stringify({ type: "connected" }));
      ws.close();
    } finally {
      delete process.env.AGENTOS_PROXY_DOMAIN;
    }
  });
});
