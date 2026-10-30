import { test } from "node:test";
import assert from "node:assert/strict";
import { linkTarget } from "../../lib/client/link-target";

const ORIGIN = "https://agent.example.com";
const PATH = { enabled: true, subdomainBase: null };

test("a dev server's localhost link opens through the proxy", () => {
  assert.equal(
    linkTarget("http://localhost:5173/app?x=1#top", ORIGIN, PATH),
    "https://agent.example.com/proxy/5173/app?x=1#top"
  );
  assert.equal(
    linkTarget("http://127.0.0.1:3000", ORIGIN, PATH),
    "https://agent.example.com/proxy/3000/"
  );
});

test("other links, and the proxy off or AgentOS on localhost, stay as they are", () => {
  assert.equal(
    linkTarget("https://github.com/x", ORIGIN, PATH),
    "https://github.com/x"
  );
  assert.equal(
    linkTarget("http://localhost:5173/", ORIGIN, {
      enabled: false,
      subdomainBase: null,
    }),
    "http://localhost:5173/"
  );
  assert.equal(
    linkTarget("http://localhost:5173/", "http://localhost:3011", PATH),
    "http://localhost:5173/"
  );
});

test("subdomain mode uses the port host", () => {
  assert.equal(
    linkTarget("http://localhost:5173/a", ORIGIN, {
      enabled: true,
      subdomainBase: "p.example.com",
    }),
    "https://5173.p.example.com/a"
  );
});
