import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Socket } from "node:net";
import { IncomingMessage, ServerResponse } from "node:http";

// No auth.json and no OIDC env: sign-in is off, so no_session can't apply
const home = fs.mkdtempSync(path.join(os.tmpdir(), "agentos-proof-"));
process.env.AGENT_OS_HOME = home;
for (const key of Object.keys(process.env)) {
  if (key.startsWith("OIDC_") || key === "AUTH_SECRET") delete process.env[key];
}

let proof: typeof import("../../lib/user-proof");

before(async () => {
  proof = await import("../../lib/user-proof");
});

const HOST = "agentos.test:3099";
const ORIGIN = `http://${HOST}`;

function request(headers: Record<string, string>): Request {
  return new Request(`${ORIGIN}/api/sessions/s1/permission-mode`, {
    method: "POST",
    headers: { host: HOST, ...headers },
  });
}

/** What the browser sends on a same-origin fetch from the page */
function browser(cookie: string | null, extra: Record<string, string> = {}) {
  return request({
    origin: ORIGIN,
    "sec-fetch-site": "same-origin",
    "sec-fetch-mode": "cors",
    ...(cookie !== null && { cookie }),
    ...extra,
  });
}

/** Runs issueUserProof on a fake page load and returns the cookie it set */
function navigate(headers: Record<string, string>): string | null {
  const req = new IncomingMessage(new Socket());
  req.method = "GET";
  req.url = "/api/user-proof";
  req.headers = { host: HOST, ...headers };
  const res = new ServerResponse(req);
  proof.issueUserProof(req, res);
  const set = res.getHeader("set-cookie");
  const all = Array.isArray(set) ? set : set ? [String(set)] : [];
  return all.find((c) => c.startsWith(`${proof.USER_PROOF_COOKIE}=`)) ?? null;
}

const cookieOf = (setCookie: string) => setCookie.split(";")[0];

describe("requireUser", () => {
  test("fails closed with no proof", () => {
    assert.deepEqual(proof.requireUser(browser(null)), {
      ok: false,
      reason: "no_proof",
    });
  });

  test("the request matrix", () => {
    const good = `${proof.USER_PROOF_COOKIE}=${proof.userSecret()}`;
    const cases: [string, Request, false | string][] = [
      ["browser with the cookie", browser(good), false],
      [
        "agent header",
        browser(good, { "x-agentos-origin": "agent" }),
        "agent_origin",
      ],
      [
        "cross-site",
        browser(good, { "sec-fetch-site": "cross-site" }),
        "cross_site",
      ],
      [
        "other origin",
        browser(good, { origin: "http://evil.test" }),
        "cross_site",
      ],
      ["no Sec-Fetch-Site (curl)", request({ cookie: good }), "cross_site"],
      ["missing cookie", browser(null), "no_proof"],
      [
        "stale cookie (earlier boot)",
        browser(`${proof.USER_PROOF_COOKIE}=${"0".repeat(64)}`),
        "no_proof",
      ],
    ];
    for (const [name, req, reason] of cases) {
      const out = proof.requireUser(req);
      assert.deepEqual(
        out,
        reason ? { ok: false, reason } : { ok: true },
        name
      );
    }
  });
});

describe("issueUserProof", () => {
  test("sets the cookie on a same-origin iframe navigation", () => {
    const set = navigate({
      "sec-fetch-mode": "navigate",
      "sec-fetch-dest": "iframe",
      "sec-fetch-site": "same-origin",
    });
    assert.ok(set, "cookie issued");
    assert.match(set, /HttpOnly/i);
    assert.match(set, /SameSite=Strict/i);
    assert.match(set, /Path=\//);
    // and that cookie passes
    assert.deepEqual(proof.requireUser(browser(cookieOf(set))), { ok: true });
  });

  test("sets it on a direct page load", () => {
    assert.ok(
      navigate({
        "sec-fetch-mode": "navigate",
        "sec-fetch-dest": "document",
        "sec-fetch-site": "none",
      })
    );
  });

  test("never on fetches, cross-site navigations or agent requests", () => {
    const none: Record<string, string>[] = [
      {},
      { "sec-fetch-mode": "cors", "sec-fetch-site": "same-origin" },
      {
        "sec-fetch-mode": "navigate",
        "sec-fetch-dest": "document",
        "sec-fetch-site": "cross-site",
      },
      {
        "sec-fetch-mode": "navigate",
        "sec-fetch-dest": "image",
        "sec-fetch-site": "same-origin",
      },
      {
        "sec-fetch-mode": "navigate",
        "sec-fetch-dest": "iframe",
        "sec-fetch-site": "same-origin",
        "x-agentos-origin": "agent",
      },
    ];
    for (const headers of none) {
      assert.equal(navigate(headers), null, JSON.stringify(headers));
    }
  });
});
