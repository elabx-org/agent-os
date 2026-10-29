import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

// No auth.json here: sign-in is off (see user-proof-auth.test.ts for on)
process.env.AGENT_OS_HOME = mkdtempSync(path.join(tmpdir(), "agentos-proof-"));
for (const key of [
  "OIDC_ISSUER",
  "OIDC_CLIENT_ID",
  "OIDC_CLIENT_SECRET",
  "AGENT_OS_PUBLIC_URL",
  "AUTH_SECRET",
]) {
  delete process.env[key];
}

import {
  isUserPageRequest,
  issueUserProof,
  requireUser,
  userSecret,
  USER_PROOF_COOKIE,
} from "../../lib/user-proof";

const HOST = "agent.example.com";

function post(headers: Record<string, string>): Request {
  return new Request(`http://${HOST}/api/sessions/s1/prompt`, {
    method: "POST",
    headers: new Headers(headers),
  });
}

const browser = (extra: Record<string, string> = {}) =>
  post({
    host: HOST,
    origin: `https://${HOST}`,
    "sec-fetch-site": "same-origin",
    cookie: `other=1; ${USER_PROOF_COOKIE}=${userSecret()}`,
    ...extra,
  });

test("userSecret is stable for the process and lives on globalThis", () => {
  assert.equal(userSecret(), userSecret());
  assert.ok(userSecret().length >= 43);
  assert.equal(
    (globalThis as { __agentosUserSecret?: string }).__agentosUserSecret,
    userSecret()
  );
});

test("requireUser: the user's browser passes", () => {
  assert.deepEqual(requireUser(browser()), { ok: true });
});

test("requireUser: an agent's header fails even with a valid cookie", () => {
  assert.deepEqual(requireUser(browser({ "x-agentos-origin": "Agent" })), {
    ok: false,
    reason: "agent_origin",
  });
});

test("requireUser: cross-site, missing fetch metadata or a foreign Origin", () => {
  const cross = { ok: false, reason: "cross_site" };
  assert.deepEqual(
    requireUser(browser({ "sec-fetch-site": "cross-site" })),
    cross
  );
  assert.deepEqual(
    requireUser(browser({ "sec-fetch-site": "same-site" })),
    cross
  );
  assert.deepEqual(
    requireUser(browser({ origin: "https://evil.example.com" })),
    cross
  );
  assert.deepEqual(requireUser(browser({ origin: "null" })), cross);
  // curl: cookie stolen or not, no browser metadata
  assert.deepEqual(
    requireUser(
      post({ host: HOST, cookie: `${USER_PROOF_COOKIE}=${userSecret()}` })
    ),
    cross
  );
});

test("requireUser: behind the proxy, Origin may match X-Forwarded-Host", () => {
  assert.deepEqual(
    requireUser(browser({ host: "localhost:3011", "x-forwarded-host": HOST })),
    { ok: true }
  );
});

test("requireUser: missing or stale cookie is no_proof", () => {
  const noProof = { ok: false, reason: "no_proof" };
  assert.deepEqual(requireUser(browser({ cookie: "other=1" })), noProof);
  // A cookie from before a server restart (other per-boot secret)
  assert.deepEqual(
    requireUser(browser({ cookie: `${USER_PROOF_COOKIE}=stale-secret` })),
    noProof
  );
  assert.deepEqual(
    requireUser(
      browser({ cookie: `${USER_PROOF_COOKIE}=${userSecret().slice(1)}x` })
    ),
    noProof
  );
});

// --- issueUserProof ---

function fakeRes() {
  const headers = new Map<string, string | string[]>();
  return {
    headers,
    getHeader: (name: string) => headers.get(name.toLowerCase()),
    setHeader: (name: string, value: string | string[]) => {
      headers.set(name.toLowerCase(), value);
    },
  };
}

function navigation(headers: Record<string, string>, method = "GET") {
  return {
    method,
    headers: {
      host: HOST,
      "sec-fetch-mode": "navigate",
      "sec-fetch-dest": "document",
      "sec-fetch-site": "none",
      ...headers,
    },
    socket: {},
  } as unknown as IncomingMessage;
}

function issued(req: IncomingMessage, res = fakeRes()): string[] {
  issueUserProof(req, res as unknown as ServerResponse);
  const value = res.headers.get("set-cookie");
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

test("issueUserProof: a page navigation gets the cookie", () => {
  const [cookie, ...rest] = issued(navigation({}));
  assert.equal(rest.length, 0);
  assert.equal(cookie.split(";")[0], `${USER_PROOF_COOKIE}=${userSecret()}`);
  assert.match(cookie, /; HttpOnly/);
  assert.match(cookie, /; SameSite=Strict/);
  assert.match(cookie, /; Path=\//);
  assert.doesNotMatch(cookie, /Max-Age|Secure/);
});

test("issueUserProof: Secure behind an https proxy", () => {
  const [cookie] = issued(navigation({ "x-forwarded-proto": "https" }));
  assert.match(cookie, /; Secure/);
});

test("issueUserProof: the proof iframe re-issues a stale cookie", () => {
  const req = navigation({
    "sec-fetch-dest": "iframe",
    "sec-fetch-site": "same-origin",
    cookie: `${USER_PROOF_COOKIE}=stale-secret`,
  });
  const [cookie] = issued(req);
  const value = cookie.split(";")[0];
  // The retried request with the new cookie passes
  assert.deepEqual(requireUser(browser({ cookie: value })), { ok: true });
});

test("issueUserProof: nothing for fetches, cross-site, agents or a valid cookie", () => {
  assert.deepEqual(issued(navigation({ "sec-fetch-mode": "cors" })), []);
  assert.deepEqual(issued(navigation({ "sec-fetch-dest": "empty" })), []);
  assert.deepEqual(issued(navigation({ "sec-fetch-site": "cross-site" })), []);
  assert.deepEqual(issued(navigation({ "sec-fetch-site": "same-site" })), []);
  assert.deepEqual(issued(navigation({ "x-agentos-origin": "agent" })), []);
  assert.deepEqual(issued(navigation({}, "POST")), []);
  // curl: no fetch metadata at all
  assert.deepEqual(
    issued({ method: "GET", headers: { host: HOST }, socket: {} } as never),
    []
  );
  assert.deepEqual(
    issued(navigation({ cookie: `${USER_PROOF_COOKIE}=${userSecret()}` })),
    []
  );
});

test("issueUserProof: keeps a Set-Cookie already on the response", () => {
  const res = fakeRes();
  res.setHeader("Set-Cookie", "a=1");
  const cookies = issued(navigation({}), res);
  assert.equal(cookies.length, 2);
  assert.equal(cookies[0], "a=1");
  assert.ok(cookies[1].startsWith(`${USER_PROOF_COOKIE}=`));
});

// Browsers send no Sec-Fetch-* to a plain http origin (a LAN address)
test("plain http: the Origin match stands in for Sec-Fetch-Site", () => {
  const cookie = `${USER_PROOF_COOKIE}=${userSecret()}`;
  assert.deepEqual(
    requireUser(post({ host: HOST, origin: `http://${HOST}`, cookie })),
    { ok: true }
  );
  assert.deepEqual(
    requireUser(post({ host: HOST, origin: "http://evil.test", cookie })),
    { ok: false, reason: "cross_site" }
  );
  // Behind https every browser sends it, so its absence fails
  assert.deepEqual(
    requireUser(
      post({
        host: HOST,
        origin: `http://${HOST}`,
        cookie,
        "x-forwarded-proto": "https",
      })
    ),
    { ok: false, reason: "cross_site" }
  );
});

test("plain http: issueUserProof only on a navigation (upgrade request, wants HTML)", () => {
  const plain = (headers: Record<string, string>) =>
    ({
      method: "GET",
      headers: { host: HOST, ...headers },
      socket: {},
    }) as never;
  const nav = { "upgrade-insecure-requests": "1", accept: "text/html,*/*" };
  assert.equal(issued(plain(nav)).length, 1);
  assert.deepEqual(issued(plain({ accept: "text/html" })), []);
  assert.deepEqual(issued(plain({ ...nav, "x-agentos-origin": "agent" })), []);
  assert.deepEqual(issued(plain({ ...nav, "x-forwarded-proto": "https" })), []);
});

test("requireUser: a sandboxed proxied page (Origin: null) fails even with the cookie", () => {
  // The port proxy's sandbox gives the app an opaque origin; the browser
  // still attaches agentos_u on plain http (and sends cross-site on https)
  assert.deepEqual(requireUser(browser({ origin: "null" })), {
    ok: false,
    reason: "cross_site",
  });
  assert.deepEqual(
    requireUser(
      post({
        host: HOST,
        origin: "null",
        cookie: `${USER_PROOF_COOKIE}=${userSecret()}`,
      })
    ),
    { ok: false, reason: "cross_site" }
  );
});

test("requireUser: a tossed duplicate agentos_u can't hide the real one", () => {
  // A sibling port host can plant agentos_u for the parent domain; the
  // browser then sends both, the planted one first
  assert.deepEqual(
    requireUser(
      browser({
        cookie: `${USER_PROOF_COOKIE}=planted; ${USER_PROOF_COOKIE}=${userSecret()}`,
      })
    ),
    { ok: true }
  );
  assert.deepEqual(
    requireUser(
      browser({
        cookie: `${USER_PROOF_COOKIE}=planted; ${USER_PROOF_COOKIE}=also`,
      })
    ),
    { ok: false, reason: "no_proof" }
  );
});

test("isUserPageRequest: the proof cookie on a same-origin read", () => {
  const read = (headers: Record<string, string>) =>
    isUserPageRequest(
      new Request(`http://${HOST}/api/browser-open`, {
        headers: new Headers({ host: HOST, ...headers }),
      })
    );
  const proof = `${USER_PROOF_COOKIE}=${userSecret()}`;
  // A same-origin GET carries no Origin
  assert.ok(read({ "sec-fetch-site": "same-origin", cookie: proof }));
  // Plain http LAN page: no Sec-Fetch-*
  assert.ok(read({ cookie: proof }));
  // Loopback tools forging the forwarded host have no proof
  assert.ok(
    !read({
      "sec-fetch-site": "same-origin",
      "x-forwarded-host": "evil.example",
      "x-forwarded-proto": "https",
    })
  );
  assert.ok(!read({ "sec-fetch-site": "cross-site", cookie: proof }));
  assert.ok(!read({ cookie: `${USER_PROOF_COOKIE}=wrong` }));
  assert.ok(
    !read({
      "sec-fetch-site": "same-origin",
      cookie: proof,
      "x-agentos-origin": "agent",
    })
  );
});
