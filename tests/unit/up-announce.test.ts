import { test } from "node:test";
import assert from "node:assert/strict";
import type { UpEvent } from "../../lib/link/hub";
import type { NewMachineAction } from "../../lib/link/machine-actions";
import type { MachineRow } from "../../lib/link/store";
import { upRefusal } from "../../lib/link/up";
import { AGENT_UP_RULES } from "../../lib/link/up-agent-rules";
import {
  announceRefusal,
  announceUp,
  type Announcement,
  type AnnounceDeps,
} from "../../lib/link/up-announce";

const SID = "0123abcd-0000-4000-8000-0123456789ab";
let n = 0;
/** A machine of its own per test: the message throttle is shared */
const machine = () =>
  ({
    id: `m_${String(++n).padStart(12, "0")}`,
    name: "Mac Studio",
    status: "approved",
  }) as MachineRow;

const rule = (action: string) =>
  AGENT_UP_RULES.find((r) => r.action === action)!;

function fakes(now = { at: 1_000_000 }) {
  const rows: NewMachineAction[] = [];
  const notes: { message: Announcement; push: boolean }[] = [];
  const deps: AnnounceDeps = {
    record: (r) => rows.push(r),
    lastRefused: (id, detail) => {
      const hits = rows.filter(
        (r) =>
          r.machine_id === id && r.action === "refused" && r.detail === detail
      );
      return hits.length ? hits[hits.length - 1].at! : null;
    },
    sessionName: (id) => (id === SID ? "Fix the build" : null),
    machineName: () => "Mac mini",
    notify: (message, push) => notes.push({ message, push }),
    now: () => now.at,
  };
  return { rows, notes, deps, now };
}

const event = (m: MachineRow, over: Partial<UpEvent>): UpEvent => ({
  machine: m,
  rule: rule("message"),
  targetMachineId: null,
  pathname: `/api/sessions/${SID}/send-keys`,
  status: 200,
  sent: { text: "The secret plan is in notes.md" },
  answer: { success: true },
  ...over,
});

test("announce: a start is recorded and pushed with its name", () => {
  const { rows, notes, deps } = fakes();
  const m = machine();
  announceUp(
    event(m, {
      rule: rule("start"),
      pathname: "/api/sessions",
      status: 201,
      sent: { initialPrompt: "Build the iOS app", projectId: "p" },
      answer: { session: { id: SID, name: "iOS build" } },
    }),
    deps
  );
  assert.equal(rows[0].action, "start");
  assert.equal(rows[0].detail, "Build the iOS app");
  assert.equal(rows[0].target_name, "iOS build");
  assert.deepEqual(notes, [
    {
      message: {
        title: "Mac Studio started a session here",
        body: '"iOS build"',
        sessionId: SID,
      },
      push: true,
    },
  ]);
});

test("announce: a message's push never carries its text, and comes once per 10 minutes", () => {
  const { rows, notes, deps, now } = fakes();
  const m = machine();
  announceUp(event(m, {}), deps);
  announceUp(event(m, {}), deps);
  now.at += 9 * 60_000;
  announceUp(event(m, {}), deps);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].detail, "The secret plan is in notes.md");
  assert.equal(notes.length, 1);
  assert.equal(
    notes[0].message.title,
    'Mac Studio sent a message to "Fix the build"'
  );
  assert.equal(JSON.stringify(notes).includes("secret"), false);
  now.at += 2 * 60_000;
  announceUp(event(m, {}), deps);
  assert.equal(notes.length, 2);
});

test("announce: answer, interrupt and stop are history entries only", () => {
  const { notes, deps } = fakes();
  const m = machine();
  announceUp(
    event(m, {
      rule: rule("answer"),
      pathname: `/api/sessions/${SID}/prompt`,
      sent: { index: 0, label: "Yes" },
    }),
    deps
  );
  announceUp(
    event(m, {
      rule: rule("interrupt"),
      pathname: `/api/sessions/${SID}/interrupt`,
    }),
    deps
  );
  announceUp(
    event(m, {
      rule: rule("stop"),
      pathname: `/m/m_abcdefabcdef/api/sessions/${SID}/stop`,
      targetMachineId: "m_abcdefabcdef",
    }),
    deps
  );
  assert.deepEqual(
    notes.map((x) => [x.message.title, x.push]),
    [
      ['Mac Studio answered a question in "Fix the build"', false],
      ['Mac Studio interrupted "Fix the build"', false],
      ["Mac Studio stopped a session", false],
    ]
  );
  assert.equal(notes[2].message.body, "On Mac mini");
});

test("announce: a refused answer is a refused row and no notification", () => {
  const { rows, notes, deps } = fakes();
  const m = machine();
  announceUp(
    event(m, {
      status: 403,
      answer: { error: "Only plain messages", code: "plain_text_only" },
    }),
    deps
  );
  assert.equal(rows[0].action, "refused");
  assert.equal(rows[0].detail, "Only plain messages");
  assert.equal(rows[0].allowed, 0);
  assert.equal(notes.length, 0);
});

test("announce: the switch being off is told once an hour", () => {
  const { rows, notes, deps, now } = fakes();
  const m = machine();
  announceRefusal(m, upRefusal("hub_agents_off"), deps);
  announceRefusal(m, upRefusal("hub_agents_off"), deps);
  announceRefusal(m, upRefusal("too_many"), deps);
  assert.equal(rows.length, 1);
  assert.equal(notes.length, 1);
  assert.equal(
    notes[0].message.title,
    "Mac Studio's sessions tried to use this server"
  );
  assert.equal(
    notes[0].message.body,
    "It's switched off. You can allow it in Settings, Machines."
  );
  assert.equal(notes[0].push, false);
  now.at += 61 * 60_000;
  announceRefusal(m, upRefusal("hub_agents_off"), deps);
  assert.equal(notes.length, 2);
});
