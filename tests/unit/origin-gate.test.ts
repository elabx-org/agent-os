import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { isGatedPath, originGate } from "../../lib/origin-gate";

const HOST = "agent.example.com";
const BASE = { subdomainBase: HOST };

type Case = {
  origin?: string;
  site?: string;
  mode?: string;
  referer?: string;
  forwardedHost?: string;
  pathname?: string;
};

const gate = (c: Case) =>
  originGate(
    {
      host: c.forwardedHost ? "127.0.0.1:3011" : HOST,
      ...(c.forwardedHost ? { "x-forwarded-host": c.forwardedHost } : {}),
      ...(c.origin !== undefined ? { origin: c.origin } : {}),
      ...(c.site !== undefined ? { "sec-fetch-site": c.site } : {}),
      ...(c.mode !== undefined ? { "sec-fetch-mode": c.mode } : {}),
      ...(c.referer !== undefined ? { referer: c.referer } : {}),
    },
    { ...BASE, pathname: c.pathname ?? "/api/sessions" }
  );

describe("isGatedPath", () => {
  test("the API, sockets and sign-out", () => {
    assert.ok(isGatedPath("/api/sessions"));
    assert.ok(isGatedPath("/api"));
    assert.ok(isGatedPath("/ws/terminal"));
    assert.ok(isGatedPath("/auth/logout"));
    assert.ok(!isGatedPath("/"));
    assert.ok(!isGatedPath("/auth/login"));
    assert.ok(!isGatedPath("/_next/static/x.js"));
    assert.ok(!isGatedPath("/apis"));
    assert.ok(!isGatedPath("/proxy/5173/api/x"));
  });
});

describe("originGate", () => {
  test("Agent-OS's own pages pass", () => {
    assert.equal(gate({}), "ok");
    assert.equal(
      gate({ origin: `https://${HOST}`, site: "same-origin", mode: "cors" }),
      "ok"
    );
    assert.equal(
      gate({
        site: "same-origin",
        mode: "cors",
        referer: `https://${HOST}/?session=x`,
      }),
      "ok"
    );
    assert.equal(gate({ site: "none", mode: "navigate" }), "ok");
    // Behind a reverse proxy: X-Forwarded-Host is the public host
    assert.equal(
      gate({ origin: `https://${HOST}`, forwardedHost: HOST }),
      "ok"
    );
    // Plain http LAN page: Origin only
    assert.equal(gate({ origin: `http://${HOST}` }), "ok");
  });

  test("non-browser callers (no Origin, Sec-Fetch, Referer) pass", () => {
    assert.equal(gate({}), "ok");
  });

  test("the sandboxed page (opaque origin) is refused", () => {
    assert.equal(gate({ origin: "null" }), "opaque_origin");
    assert.equal(
      gate({ origin: "null", site: "cross-site", mode: "cors" }),
      "opaque_origin"
    );
  });

  test("other origins are refused, including sibling port hosts", () => {
    assert.equal(gate({ origin: "https://evil.example" }), "foreign_origin");
    assert.equal(
      gate({ origin: `https://5173.${HOST}`, site: "same-site", mode: "cors" }),
      "foreign_origin"
    );
    assert.equal(gate({ origin: "not a url" }), "foreign_origin");
  });

  test("Sec-Fetch-Site cross-site / same-site refused, navigations too", () => {
    for (const site of ["cross-site", "same-site"]) {
      for (const mode of ["cors", "no-cors", "same-origin", "websocket"]) {
        assert.equal(gate({ site, mode }), "cross_site", `${site} ${mode}`);
      }
      assert.equal(gate({ site }), "cross_site", `${site} without mode`);
      // window.open('/api/...') from a sandboxed popup or another site
      assert.equal(
        gate({ site, mode: "navigate" }),
        "cross_site",
        `${site} navigate /api`
      );
      assert.equal(
        gate({ site, mode: "navigate", pathname: "/ws/terminal" }),
        "cross_site",
        `${site} navigate /ws`
      );
      // A sign-out link from another site still works
      assert.equal(
        gate({ site, mode: "navigate", pathname: "/auth/logout" }),
        "ok",
        `${site} navigate logout`
      );
    }
    for (const site of ["same-origin", "none"]) {
      for (const mode of ["cors", "no-cors", "navigate"]) {
        assert.equal(gate({ site, mode }), "ok", `${site} ${mode}`);
      }
    }
  });

  test("a Referer under the proxy is refused (plain-http sandboxed GETs)", () => {
    assert.equal(
      gate({ referer: `http://${HOST}/proxy/5173/page` }),
      "proxied_referer"
    );
    assert.equal(
      gate({ referer: `http://${HOST}/absproxy/5173/` }),
      "proxied_referer"
    );
    assert.equal(gate({ referer: `https://5173.${HOST}/` }), "proxied_referer");
    assert.equal(gate({ referer: `https://${HOST}/proxy` }), "ok");
    assert.equal(gate({ referer: "garbage" }), "ok");
  });

  test("without a subdomain base, port-host referers are just referers", () => {
    assert.equal(
      originGate({ host: HOST, referer: `https://5173.${HOST}/` }, {}),
      "ok"
    );
  });
});
