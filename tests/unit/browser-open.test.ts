import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  FRESH_MS,
  MAX_URL_LENGTH,
  classifyUrl,
  cleanSessionName,
  createState,
  eventsAfter,
  learnPublicBase,
  recordOpen,
  waitForEvents,
} from "../../lib/browser-open";
import {
  isLocalOrigin,
  parseLoopbackUrl,
  proxyUrlFor,
} from "../../lib/proxy-url";

describe("classifyUrl", () => {
  test("loopback URLs with a port", () => {
    assert.deepEqual(
      classifyUrl("http://localhost:1455/auth/callback?code=x"),
      {
        url: "http://localhost:1455/auth/callback?code=x",
        kind: "loopback",
        host: "localhost:1455",
        port: 1455,
        path: "/auth/callback?code=x",
      }
    );
    assert.equal(classifyUrl("http://127.0.0.1:8080")?.kind, "loopback");
    assert.equal(classifyUrl("http://[::1]:8080/")?.kind, "loopback");
    assert.equal(classifyUrl("http://0.0.0.0:8080/")?.kind, "loopback");
  });

  test("external links, with a localhost redirect_uri found", () => {
    const url =
      "https://auth.openai.com/oauth/authorize?client_id=x&redirect_uri=" +
      encodeURIComponent("http://localhost:1455/auth/callback");
    assert.deepEqual(classifyUrl(url), {
      url,
      kind: "external",
      host: "auth.openai.com",
      callbackPort: 1455,
    });
    assert.deepEqual(classifyUrl("https://claude.ai/oauth"), {
      url: "https://claude.ai/oauth",
      kind: "external",
      host: "claude.ai",
    });
  });

  test("rejects non-http, junk and huge URLs", () => {
    for (const bad of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "data:text/html,x",
      "not a url",
      "",
      42,
      null,
      `https://x.example/${"a".repeat(MAX_URL_LENGTH)}`,
    ]) {
      assert.equal(classifyUrl(bad), null, String(bad).slice(0, 40));
    }
  });
});

describe("recordOpen", () => {
  test("stores, de-dupes within 10s and rate-limits at 10 a minute", () => {
    const state = createState();
    const now = 1_000_000;
    const first = recordOpen("https://a.example/1", "claude-x", state, now);
    assert.ok(first.ok && !first.duplicate && first.event.seq === 1);
    const again = recordOpen("https://a.example/1", null, state, now + 5000);
    assert.ok(again.ok && again.duplicate && again.event.seq === 1);
    for (let i = 2; i <= 10; i++) {
      assert.ok(recordOpen(`https://a.example/${i}`, null, state, now + i).ok);
    }
    assert.deepEqual(
      recordOpen("https://a.example/11", null, state, now + 11),
      {
        ok: false,
        reason: "rate_limited",
      }
    );
    assert.ok(recordOpen("https://a.example/12", null, state, now + 61_000).ok);
    assert.deepEqual(recordOpen("ftp://x", null, state, now), {
      ok: false,
      reason: "invalid",
    });
  });

  test("keeps the last 20", () => {
    const state = createState();
    for (let i = 0; i < 25; i++) {
      // A minute apart: no rate limit
      recordOpen(`https://a.example/${i}`, null, state, i * 61_000);
    }
    assert.equal(state.events.length, 20);
    assert.equal(state.events[0].seq, 6);
  });

  test("session names are kept only when plain", () => {
    assert.equal(cleanSessionName("claude-abc_1.2"), "claude-abc_1.2");
    assert.equal(cleanSessionName("<img src=x>"), null);
    assert.equal(cleanSessionName(""), null);
    assert.equal(cleanSessionName(5), null);
  });
});

describe("eventsAfter / waitForEvents", () => {
  test("a new tab gets only the seq, then newer fresh events", () => {
    const state = createState();
    const now = Date.now();
    recordOpen("https://a.example/old", null, state, now - FRESH_MS - 1);
    recordOpen("https://a.example/new", null, state, now);
    assert.deepEqual(eventsAfter(null, state, now), []);
    assert.deepEqual(
      eventsAfter(0, state, now).map((e) => e.url),
      ["https://a.example/new"]
    );
  });

  test("a waiting poll wakes on a new link", async () => {
    const state = createState();
    const waiting = waitForEvents(0, 5000, state);
    assert.equal(state.waiters.size, 1);
    recordOpen("http://localhost:5173/", "s", state);
    const result = await waiting;
    assert.equal(result.seq, 1);
    assert.equal(result.events[0].port, 5173);
    assert.equal(state.waiters.size, 0);
  });

  test("times out empty, and ends on abort", async () => {
    const state = createState();
    assert.deepEqual(await waitForEvents(0, 10, state), { events: [], seq: 0 });
    const controller = new AbortController();
    const waiting = waitForEvents(0, 60_000, state, controller.signal);
    controller.abort();
    assert.deepEqual(await waiting, { events: [], seq: 0 });
    assert.equal(state.waiters.size, 0);
  });

  test("learnPublicBase ignores loopback and junk", () => {
    const state = createState();
    learnPublicBase("http://localhost:3011", state);
    learnPublicBase("https://x/y", state);
    assert.equal(state.learnedBase, null);
    learnPublicBase("https://agent.example.com", state);
    assert.equal(state.learnedBase, "https://agent.example.com");
  });
});

describe("proxyUrlFor", () => {
  test("remote origin: /proxy/<port>/, path and query kept", () => {
    assert.equal(
      proxyUrlFor(1455, "/auth/callback?code=x", {
        origin: "https://agent.example.com/",
        enabled: true,
      }),
      "https://agent.example.com/proxy/1455/auth/callback?code=x"
    );
    assert.equal(
      proxyUrlFor(5173, "", { origin: "http://172.30.0.42:3112" }),
      "http://172.30.0.42:3112/proxy/5173/"
    );
  });

  test("subdomain base: the port host, same scheme", () => {
    assert.equal(
      proxyUrlFor(5173, "/x", {
        origin: "https://agent.example.com",
        subdomainBase: "agent.example.com",
      }),
      "https://5173.agent.example.com/x"
    );
  });

  test("local origin or proxy off: the localhost URL", () => {
    assert.equal(
      proxyUrlFor(5173, "/x", { origin: "http://localhost:3011" }),
      "http://localhost:5173/x"
    );
    assert.equal(
      proxyUrlFor(5173, "/x", {
        origin: "https://agent.example.com",
        enabled: false,
      }),
      "http://localhost:5173/x"
    );
  });

  test("parseLoopbackUrl / isLocalOrigin", () => {
    assert.deepEqual(parseLoopbackUrl("http://localhost:3000/a?b#c"), {
      port: 3000,
      path: "/a?b#c",
    });
    assert.equal(parseLoopbackUrl("http://localhost/a"), null);
    assert.equal(parseLoopbackUrl("http://example.com:3000/"), null);
    assert.ok(isLocalOrigin("http://127.0.0.1:3011"));
    assert.ok(!isLocalOrigin("https://agent.example.com"));
  });
});
