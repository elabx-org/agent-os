import { test } from "node:test";
import assert from "node:assert/strict";
import type { MachineRow } from "../../lib/link/store";
import { BASE_UP_RULES, decideUp, type UpDecision } from "../../lib/link/up";
import { AGENT_UP_RULES } from "../../lib/link/up-agent-rules";
import {
  RateWindows,
  allowStartDown,
  beforeUp,
} from "../../lib/link/up-policy";

const RULES = [...BASE_UP_RULES, ...AGENT_UP_RULES];
const OTHER = "m_abcdefabcdef";
const SID = "0123abcd-0000-4000-8000-0123456789ab";
const SID2 = "0123abcd-0000-4000-8000-0123456789ac";

const machine = {
  id: "m_000000000001",
  name: "Test Mac",
  status: "approved",
  uses_hub: 1,
  backup: 0,
} as MachineRow;

function decision(method: string, p: string) {
  const d = decideUp(
    RULES,
    machine,
    { kind: "agent", method, path: p, headers: {} },
    { port: 3011, proof: "x" }
  );
  assert.ok(d.ok);
  return d as Extract<UpDecision, { ok: true }>;
}

const deps = (windows: RateWindows, now: () => number, cap = true) => ({
  hasCap: () => cap,
  windows,
  now,
});

test("policy: the 7th start in a minute is refused, then allowed again", () => {
  const windows = new RateWindows();
  let now = 1_000_000;
  const start = decision("POST", "/api/sessions");
  for (let i = 0; i < 6; i++) {
    assert.equal(
      beforeUp(
        start,
        machine,
        deps(windows, () => now)
      ),
      null
    );
  }
  assert.equal(
    beforeUp(
      start,
      machine,
      deps(windows, () => now)
    )?.code,
    "too_many"
  );
  now += 61_000;
  assert.equal(
    beforeUp(
      start,
      machine,
      deps(windows, () => now)
    ),
    null
  );
});

test("policy: the 31st start in an hour is refused", () => {
  const windows = new RateWindows();
  let now = 1_000_000;
  const start = decision("POST", "/api/sessions");
  for (let i = 0; i < 30; i++) {
    assert.equal(
      beforeUp(
        start,
        machine,
        deps(windows, () => now)
      ),
      null,
      `start ${i}`
    );
    now += 11_000;
  }
  assert.equal(
    beforeUp(
      start,
      machine,
      deps(windows, () => now)
    )?.code,
    "too_many"
  );
});

test("policy: the 31st message to one session in an hour is refused, others still go", () => {
  const windows = new RateWindows();
  const now = () => 5_000_000;
  const one = decision("POST", `/api/sessions/${SID}/send-keys`);
  const two = decision("POST", `/api/sessions/${SID2}/send-keys`);
  for (let i = 0; i < 30; i++) {
    assert.equal(beforeUp(one, machine, deps(windows, now)), null);
  }
  assert.equal(beforeUp(one, machine, deps(windows, now))?.code, "too_many");
  assert.equal(beforeUp(two, machine, deps(windows, now)), null);
  // Reads are not counted
  const read = decision("GET", "/api/sessions");
  for (let i = 0; i < 100; i++) {
    assert.equal(beforeUp(read, machine, deps(windows, now)), null);
  }
});

test("policy: a relay only to a machine that names up1", () => {
  const windows = new RateWindows();
  const now = () => 1;
  const relay = decision("GET", `/m/${OTHER}/api/sessions`);
  assert.equal(
    beforeUp(relay, machine, deps(windows, now, false))?.code,
    "machine_old"
  );
  assert.equal(
    beforeUp(relay, machine, { hasCap: () => null, windows, now })?.code,
    "machine_offline"
  );
  assert.equal(beforeUp(relay, machine, deps(windows, now, true)), null);
});

test("policy: starts going down to a machine have the same limits", () => {
  const windows = new RateWindows();
  for (let i = 0; i < 6; i++)
    assert.equal(allowStartDown(OTHER, windows, 10), true);
  assert.equal(allowStartDown(OTHER, windows, 10), false);
  assert.equal(allowStartDown("m_000000000009", windows, 10), true);
});
