/**
 * The hub's side of a linked machine's notifications: a machine says a
 * session needs the user or finished, and the hub records it and notifies
 * the way the user set up here (the machine has no phone of its own).
 * Everything in a notice comes from the machine, so it is checked and
 * clipped, and a machine can only send so many.
 */

import { isWatching, readPushConfig } from "../push/config";
import { recordNotification, setDelivered } from "../push/history";
import { sendPush, type PushMessage } from "../push/send";
import type { LinkNotice } from "./protocol";
import type { MachineRow } from "./store";

type Kind = PushMessage["kind"];

/** What a machine may announce, and the switch in Settings that covers it */
const SWITCH: Partial<
  Record<Kind, keyof ReturnType<typeof readPushConfig>["events"]>
> = {
  needsYou: "needsYou",
  agentNeedsYou: "needsYou",
  finished: "finished",
  agentFinished: "backgroundFinished",
  limited: "limited",
  resumed: "resumed",
  settled: "settled",
};

const MAX_PER_MINUTE = 20;
const recent = new Map<string, number[]>();

const clip = (value: unknown, max: number): string =>
  typeof value === "string"
    ? value.replace(/[\u0000-\u001f]+/g, " ").slice(0, max)
    : "";

const id = (value: unknown): string | undefined =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value)
    ? value
    : undefined;

/** A notice as the hub will show it, or null when it isn't one */
export function checkedNotice(
  machine: Pick<MachineRow, "id" | "name">,
  notice: LinkNotice
): (PushMessage & { projectName?: string; machineId: string }) | null {
  const kind = notice.kind as Kind;
  if (!Object.prototype.hasOwnProperty.call(SWITCH, kind)) return null;
  const title = clip(notice.title, 120);
  if (!title) return null;
  return {
    kind,
    title: `${title} · ${clip(machine.name, 40)}`,
    body: clip(notice.body, 300),
    sessionId: id(notice.sessionId),
    agentId: id(notice.agentId),
    projectName: clip(notice.projectName, 80) || undefined,
    machineId: machine.id,
  };
}

function allowed(machineId: string, now: number): boolean {
  const times = (recent.get(machineId) ?? []).filter((t) => now - t < 60_000);
  if (times.length >= MAX_PER_MINUTE) {
    recent.set(machineId, times);
    return false;
  }
  times.push(now);
  recent.set(machineId, times);
  return true;
}

export function receiveNotice(machine: MachineRow, notice: LinkNotice): void {
  if (!allowed(machine.id, Date.now())) return;
  const msg = checkedNotice(machine, notice);
  if (!msg) return;
  const config = readPushConfig();
  const { projectName, ...push } = msg;
  const entry = recordNotification({ ...push, projectName });
  const on = config.events[SWITCH[msg.kind]!];
  const channels = config.ntfy.enabled || config.apns.enabled;
  if (!on || !channels) return;
  if (msg.sessionId && isWatching(msg.sessionId)) return;
  const base = config.publicUrl.replace(/\/+$/, "");
  if (msg.sessionId) {
    push.appUrl = `agentos://session/${msg.sessionId}?machine=${machine.id}`;
    if (base)
      push.webUrl = `${base}/?machine=${machine.id}&session=${msg.sessionId}`;
  }
  sendPush(push).then((report) => {
    console.log(`[push] ${push.title}:`, JSON.stringify(report));
    setDelivered(entry.id, report);
  });
}
