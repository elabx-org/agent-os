/**
 * What a linked machine may ask of the hub (lib/link/protocol.ts "up"
 * frames). Pure: the hub (lib/link/hub.ts) reads the machine's row and
 * calls decideUp, which either refuses or says exactly which loopback call
 * to make. Nothing the machine sends is passed on as it came: the path must
 * match a rule, the query keeps only the rule's keys, and the headers are
 * built from nothing so the call is always marked as an agent's (or as
 * AgentOS's own, with the per-boot proof, for copies).
 */

import type { UpKind } from "./protocol";
import type { MachineRow } from "./store";

export type UpCode =
  | "machine_unknown"
  | "bad_request"
  | "hub_agents_off"
  | "backup_off"
  | "not_allowed_from_machine"
  | "same_machine"
  | "too_many"
  | "too_large"
  | "machine_old";

export interface UpRefusal {
  ok: false;
  status: number;
  code: UpCode;
  error: string;
}

export interface UpContext {
  machine: MachineRow;
  targetMachineId: string | null;
  pathname: string;
}

export interface UpRule {
  kind: UpKind;
  method: "GET" | "POST" | "PUT" | "DELETE";
  /** Matched against the pathname after any /m/<id> prefix */
  path: RegExp;
  /** May also be asked of another machine through /m/<id> (agent only) */
  relay: boolean;
  /** Query keys kept; every other key is dropped. Values must match /^[\w.:-]{0,200}$/ */
  query?: string[];
  maxBody: number;
  headMs: number;
  /** Agent POST only: builds the body the hub sends from the machine's parsed JSON. Absent: an empty body is sent */
  body?(input: unknown, ctx: UpContext): { body: unknown } | UpRefusal;
  /** Audit label (stage 2): "start" | "message" | "answer" | "interrupt" | "stop" */
  action?: string;
}

export type UpDecision =
  | {
      ok: true;
      rule: UpRule;
      /** The loopback path to ask, with the rebuilt query */
      path: string;
      targetMachineId: string | null;
      headers: Record<string, string>;
    }
  | UpRefusal;

const STATUS: Record<UpCode, number> = {
  machine_unknown: 403,
  bad_request: 400,
  hub_agents_off: 403,
  backup_off: 403,
  not_allowed_from_machine: 403,
  same_machine: 400,
  too_many: 429,
  too_large: 413,
  machine_old: 409,
};

export const UP_ERRORS: Record<UpCode, string> = {
  hub_agents_off:
    "Sessions on this machine aren't allowed to use the server. The user can allow it in AgentOS: Settings, Machines.",
  not_allowed_from_machine:
    "That isn't something a session on another machine can do here.",
  backup_off: "Copies from this machine are turned off on the server.",
  machine_unknown: "This machine is no longer linked.",
  same_machine: 'That is this machine. Leave out "machine" to work here.',
  too_many:
    "Too many requests from this machine in a short time. Wait a minute and try again.",
  too_large: "That is too much to send in one go.",
  machine_old: "That machine needs to update before it can be used this way.",
  bad_request: "That request isn't one AgentOS understands.",
};

/** What the machine itself answers when it can't ask the hub at all */
export type UpLocalCode =
  | "not_linked"
  | "hub_too_old"
  | "link_dropped"
  | "timeout"
  | "local_only";

export const UP_LOCAL_ERRORS: Record<
  UpLocalCode,
  { status: number; error: string }
> = {
  not_linked: {
    status: 503,
    error: "This machine isn't connected to its server right now.",
  },
  hub_too_old: {
    status: 503,
    error:
      "The server's AgentOS needs to update before sessions here can use it.",
  },
  link_dropped: {
    status: 502,
    error: "The connection to the server dropped. Try again.",
  },
  timeout: { status: 504, error: "The server took too long to answer." },
  local_only: {
    status: 403,
    error: "This can only be asked from this machine itself.",
  },
};

export function upRefusal(code: UpCode): UpRefusal {
  return { ok: false, status: STATUS[code], code, error: UP_ERRORS[code] };
}

/** Where copies arrive; only the "system" kind may reach it */
const INBOX = "/api/link/inbox/";
const PATHNAME = /^\/[A-Za-z0-9/_-]+$/;
const RELAY = /^\/m\/(m_[0-9a-f]{12})(\/.*)$/;
const QUERY_VALUE = /^[\w.:-]{0,200}$/;
const METHODS = new Set(["GET", "POST", "PUT", "DELETE"]);
const KINDS = new Set(["agent", "system"]);
const BODY_TYPES = new Set(["application/json", "application/octet-stream"]);

const one = (value: unknown): string | null =>
  typeof value === "string"
    ? value
    : Array.isArray(value) && typeof value[0] === "string"
      ? value[0]
      : null;

/** The frame's header, by any case of its name */
function frameHeader(headers: unknown, name: string): string | null {
  if (!headers || typeof headers !== "object") return null;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return one(value);
  }
  return null;
}

function query(search: string, keys: string[] | undefined): string {
  if (!keys?.length || !search) return "";
  const given = new URLSearchParams(search);
  const kept = new URLSearchParams();
  for (const key of keys) {
    const value = given.get(key);
    if (value !== null && QUERY_VALUE.test(value)) kept.set(key, value);
  }
  const text = kept.toString();
  return text ? `?${text}` : "";
}

export function decideUp(
  rules: UpRule[],
  machine: MachineRow | null,
  frame: { kind: unknown; method: unknown; path: unknown; headers: unknown },
  env: { port: number; proof: string }
): UpDecision {
  // 1. Only a machine that is still approved
  if (!machine || machine.status !== "approved") {
    return upRefusal("machine_unknown");
  }

  // 2. The frame's shape
  const { kind, method, path } = frame;
  if (
    typeof kind !== "string" ||
    !KINDS.has(kind) ||
    typeof method !== "string" ||
    !METHODS.has(method) ||
    typeof path !== "string" ||
    path.length > 2048
  ) {
    return upRefusal("bad_request");
  }

  // 3. A plain path: no encoding, no dots, no backslashes, no "//"
  const mark = path.indexOf("?");
  const pathname = mark === -1 ? path : path.slice(0, mark);
  const search = mark === -1 ? "" : path.slice(mark);
  if (!PATHNAME.test(pathname) || pathname.includes("//")) {
    return upRefusal("bad_request");
  }

  // 4. The kind and the path must agree
  const inbox = pathname.startsWith(INBOX);
  if ((kind === "system") !== inbox) {
    return upRefusal("not_allowed_from_machine");
  }

  // 5. The user's switch for this kind
  if (kind === "agent" && machine.uses_hub !== 1) {
    return upRefusal("hub_agents_off");
  }
  if (kind === "system" && machine.backup !== 1) {
    return upRefusal("backup_off");
  }

  // 6. Another machine, through this hub (agent only)
  let rest = pathname;
  let targetMachineId: string | null = null;
  const relay = kind === "agent" ? pathname.match(RELAY) : null;
  if (relay) {
    if (relay[1] === machine.id) return upRefusal("same_machine");
    targetMachineId = relay[1];
    rest = relay[2];
  }

  // 7. A rule for exactly this
  const rule = rules.find(
    (r) =>
      r.kind === kind &&
      r.method === method &&
      r.path.test(rest) &&
      (!targetMachineId || r.relay)
  );
  if (!rule) return upRefusal("not_allowed_from_machine");

  // 9. Headers built from nothing
  const headers: Record<string, string> = {
    host: `127.0.0.1:${env.port}`,
    // Never re-routed by ?machine= or a cookie: only /m/<id> picks a machine
    "x-agentos-machine": "hub",
    "x-agentos-origin": "agent",
  };
  const type = frameHeader(frame.headers, "content-type")
    ?.split(";")[0]
    .trim()
    .toLowerCase();
  if (type && BODY_TYPES.has(type)) headers["content-type"] = type;
  const length = frameHeader(frame.headers, "content-length");
  if (length && /^\d{1,15}$/.test(length)) headers["content-length"] = length;
  if (kind === "agent") {
    headers["x-agentos-actor"] = `link:${machine.id}`;
    headers["x-agentos-from-machine"] = machine.id;
    const chain = frameHeader(frame.headers, "x-agentos-chain");
    if (chain && /^[0-9]$/.test(chain)) headers["x-agentos-chain"] = chain;
  } else {
    headers["x-agentos-link-machine"] = machine.id;
    headers["x-agentos-link-proof"] = env.proof;
  }

  return {
    ok: true,
    rule,
    // 8. Only the rule's query keys
    path:
      (targetMachineId ? `/m/${targetMachineId}` : "") +
      rest +
      query(search, rule.query),
    targetMachineId,
    headers,
  };
}

export const UP_LIMITS = {
  agent: { concurrent: 8, perMinute: 300, idleMs: 120_000 },
  system: { concurrent: 2, perMinute: 120, idleMs: 120_000 },
};

export type UpLimits = typeof UP_LIMITS;

/** Requests in flight and started in the last minute, per machine and kind */
export class UpCounter {
  private live = new Map<string, number>();
  private started = new Map<string, number[]>();

  constructor(private limits: UpLimits = UP_LIMITS) {}

  /** false: over a limit, and nothing was counted */
  enter(machineId: string, kind: UpKind, now: number): boolean {
    const key = `${machineId}|${kind}`;
    const limit = this.limits[kind];
    const live = this.live.get(key) ?? 0;
    const recent = (this.started.get(key) ?? []).filter(
      (at) => at > now - 60_000
    );
    this.started.set(key, recent);
    if (live >= limit.concurrent || recent.length >= limit.perMinute) {
      return false;
    }
    recent.push(now);
    this.live.set(key, live + 1);
    return true;
  }

  leave(machineId: string, kind: UpKind): void {
    const key = `${machineId}|${kind}`;
    const live = (this.live.get(key) ?? 0) - 1;
    if (live > 0) this.live.set(key, live);
    else this.live.delete(key);
  }
}

/** Stage 1: a machine's session may say hello; AgentOS may ping the inbox */
export const BASE_UP_RULES: UpRule[] = [
  {
    kind: "agent",
    method: "GET",
    path: /^\/api\/link\/hello$/,
    relay: false,
    maxBody: 0,
    headMs: 120_000,
  },
  {
    kind: "system",
    method: "POST",
    path: /^\/api\/link\/inbox\/ping$/,
    relay: false,
    maxBody: 1024,
    headMs: 120_000,
  },
];
