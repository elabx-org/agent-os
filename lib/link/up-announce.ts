/**
 * Telling the user what sessions on a linked machine did here
 * (HubDeps.onUp, lib/link/hub.ts): a row in Settings, Machines for each,
 * a history entry, and a push for a start (always) and a message (once
 * per session per 10 minutes). A push leaves the user's machines, so it
 * never carries the message's text. The machine's name is this server's
 * own row, never something the machine said.
 */

import { getDb, queries } from "../db";
import { recordNotification, setDelivered } from "../push/history";
import { sendPush } from "../push/send";
import type { UpEvent } from "./hub";
import {
  lastRefused,
  recordMachineAction,
  type MachineActionKind,
  type NewMachineAction,
} from "./machine-actions";
import { machineById, type MachineRow } from "./store";
import { UP_ERRORS, type UpRefusal } from "./up";

export interface Announcement {
  title: string;
  body: string;
  sessionId?: string;
  machineId?: string;
}

export interface AnnounceDeps {
  record(row: NewMachineAction): void;
  lastRefused(machineId: string, detail: string): number | null;
  /** A session's name here; null when there is none */
  sessionName(id: string): string | null;
  machineName(id: string): string | null;
  /** A history entry, and a push too when `push` */
  notify(message: Announcement, push: boolean): void;
  now(): number;
}

const MESSAGE_EVERY_MS = 10 * 60_000;
const REFUSED_EVERY_MS = 60 * 60_000;

const shared = globalThis as typeof globalThis & {
  __agentosUpAnnounced?: Map<string, number>;
};
const announced = () => (shared.__agentosUpAnnounced ??= new Map());

const SESSION =
  /\/api\/sessions\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//;

const field = (value: unknown, key: string): string | null => {
  const v =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)[key]
      : null;
  return typeof v === "string" ? v : null;
};

function defaults(): AnnounceDeps {
  return {
    record: (row) => recordMachineAction(row),
    lastRefused: (id, detail) => lastRefused(id, detail),
    sessionName: (id) =>
      (queries.getSession(getDb()).get(id) as { name?: string } | undefined)
        ?.name ?? null,
    machineName: (id) => machineById(id)?.name ?? null,
    notify: (message, push) => {
      const entry = recordNotification({ kind: "fromMachine", ...message });
      if (!push || process.env.AGENTOS_DISABLE_PUSH === "1") return;
      sendPush({
        kind: "fromMachine",
        ...message,
        // A session on another machine opens there
        ...(message.sessionId && message.machineId
          ? {
              appUrl: `agentos://session/${message.sessionId}?machine=${message.machineId}`,
            }
          : {}),
      })
        .then((report) => setDelivered(entry.id, report))
        .catch(() => {});
    },
    now: () => Date.now(),
  };
}

const VERBS: Record<string, (target: string) => string> = {
  answer: (t) => `answered a question in ${t}`,
  interrupt: (t) => `interrupted ${t}`,
  stop: (t) => `stopped ${t}`,
};

/** An upward request with an audit label was answered */
export function announceUp(event: UpEvent, deps: AnnounceDeps = defaults()) {
  const action = event.rule.action as MachineActionKind | undefined;
  if (!action) return;
  const { machine, targetMachineId: other } = event;
  const allowed = event.status >= 200 && event.status < 300;
  const answered =
    action === "start" && event.answer && typeof event.answer === "object"
      ? (event.answer as { session?: unknown }).session
      : null;
  const sessionId =
    field(answered, "id") ?? event.pathname.match(SESSION)?.[1] ?? null;
  const targetName =
    field(answered, "name") ??
    (sessionId && !other ? deps.sessionName(sessionId) : null);
  const otherName = other
    ? (deps.machineName(other) ?? "another machine")
    : null;
  const sent =
    action === "start"
      ? field(event.sent, "initialPrompt")
      : action === "message"
        ? field(event.sent, "text")
        : action === "answer"
          ? field(event.sent, "label")
          : null;

  deps.record({
    machine_id: machine.id,
    machine_name: machine.name,
    action: allowed ? action : "refused",
    target_session_id: sessionId,
    target_name: targetName,
    target_machine_id: other,
    // A refusal keeps the server's reason; never the text it refused
    detail: allowed
      ? (sent?.slice(0, 200) ?? null)
      : (field(event.answer, "error") ?? `Answered ${event.status}`),
    allowed: allowed ? 1 : 0,
  });
  if (!allowed) return;

  const target = targetName ? `"${targetName}"` : "a session";
  const where = otherName ? `On ${otherName}` : "";
  const ids = {
    ...(sessionId ? { sessionId } : {}),
    ...(other ? { machineId: other } : {}),
  };
  if (action === "start") {
    deps.notify(
      {
        title: otherName
          ? `${machine.name} started a session on ${otherName}`
          : `${machine.name} started a session here`,
        body: target,
        ...ids,
      },
      true
    );
    return;
  }
  if (action === "message") {
    const key = `${machine.id}|${other ?? "hub"}|${sessionId}`;
    const now = deps.now();
    const last = announced().get(key);
    if (last !== undefined && now - last < MESSAGE_EVERY_MS) return;
    announced().set(key, now);
    deps.notify(
      {
        title: `${machine.name} sent a message to ${target}`,
        body: where,
        ...ids,
      },
      true
    );
    return;
  }
  const verb = VERBS[action];
  if (verb) {
    deps.notify(
      { title: `${machine.name} ${verb(target)}`, body: where, ...ids },
      false
    );
  }
}

/**
 * A machine's session was turned away because its switch is off: one row
 * and one history entry an hour, so the user knows it tried
 */
export function announceRefusal(
  machine: MachineRow,
  refusal: UpRefusal,
  deps: AnnounceDeps = defaults()
) {
  if (refusal.code !== "hub_agents_off") return;
  const detail = UP_ERRORS.hub_agents_off;
  const now = deps.now();
  const last = deps.lastRefused(machine.id, detail);
  if (last !== null && now - last < REFUSED_EVERY_MS) return;
  deps.record({
    machine_id: machine.id,
    machine_name: machine.name,
    action: "refused",
    target_session_id: null,
    target_name: null,
    target_machine_id: null,
    detail,
    allowed: 0,
    at: now,
  });
  deps.notify(
    {
      title: `${machine.name}'s sessions tried to use this server`,
      body: "It's switched off. You can allow it in Settings, Machines.",
    },
    false
  );
}
