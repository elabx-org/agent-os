/**
 * What a session on a linked machine may ask of this server (stage 2 of
 * lib/link/up.ts): read the sessions and projects here, start Claude
 * sessions in a project, send them plain messages, answer their
 * questions, interrupt and stop them. Everything else is refused at the
 * door. The bodies are rebuilt from the fields named here only; the
 * routes check the same things again (lib/from-machine-rules.ts), since
 * a relayed call is answered by the other machine's routes.
 */

import { isSafeModelName } from "../model-name";
import { safeBranch } from "../session-move-types";
import { upRefusal, type UpRefusal, type UpRule } from "./up";

const ID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const session = (rest: string) => new RegExp(`^/api/sessions/${ID}/${rest}$`);

const KIB = 1024;
const HEAD_MS = 120_000;

/** Longest first message a session from another machine may give */
const PROMPT_MAX = 60_000;

const CONTROL = /[\u0000-\u001f\u007f]/g;

const bad = (error: string): UpRefusal => ({
  ...upRefusal("bad_request"),
  error,
});

const fields = (input: unknown): Record<string, unknown> =>
  input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};

/**
 * POST /api/sessions from another machine: only these fields, and a
 * Claude session that asks before acting, launched at once
 */
export function startBody(input: unknown): { body: unknown } | UpRefusal {
  const given = fields(input);
  const projectId = given.projectId;
  if (
    typeof projectId !== "string" ||
    !/^[\w-]{1,80}$/.test(projectId) ||
    projectId === "uncategorized"
  ) {
    return upRefusal("project_required");
  }
  const prompt = given.initialPrompt;
  if (prompt != null && typeof prompt !== "string") {
    return bad("The task must be text.");
  }
  if (typeof prompt === "string" && prompt.length > PROMPT_MAX) {
    return upRefusal("too_large");
  }
  const feature = given.featureName;
  if (feature != null && feature !== "" && !safeBranch(feature)) {
    return bad(
      "That branch name can't be used. Use letters, numbers, dots, dashes and slashes."
    );
  }
  const name =
    typeof given.name === "string"
      ? given.name.replace(CONTROL, "").trim().slice(0, 80)
      : "";
  const body: Record<string, unknown> = {
    ...(name ? { name } : {}),
    projectId,
    initialPrompt: typeof prompt === "string" && prompt.trim() ? prompt : null,
    ...(isSafeModelName(given.model) ? { model: given.model } : {}),
    useWorktree: given.useWorktree === true,
    featureName: typeof feature === "string" && feature ? feature : null,
    agentType: "claude",
    autoApprove: false,
    permissionMode: "manual",
    launch: true,
  };
  return { body };
}

/** A message: the text, sent with Enter; attachments and the rest dropped */
export function messageBody(input: unknown): { body: unknown } | UpRefusal {
  const text = fields(input).text;
  if (typeof text !== "string" || !text) {
    return bad("The message must be text.");
  }
  return { body: { text, pressEnter: true } };
}

/** Answering a question on screen: which option, and its label */
export function answerBody(input: unknown): { body: unknown } | UpRefusal {
  const { index, label } = fields(input);
  if (
    typeof index !== "number" ||
    !Number.isInteger(index) ||
    index < 0 ||
    index > 50 ||
    typeof label !== "string" ||
    label.length > 500
  ) {
    return bad("Pick an option by its index and label.");
  }
  return { body: { index, label } };
}

const read = (path: RegExp, relay = true, query?: string[]): UpRule => ({
  kind: "agent",
  method: "GET",
  path,
  relay,
  ...(query ? { query } : {}),
  maxBody: 0,
  headMs: HEAD_MS,
});

export const AGENT_UP_RULES: UpRule[] = [
  read(/^\/api\/link\/peers$/, false),
  read(/^\/api\/projects$/),
  read(/^\/api\/sessions$/, true, ["settled"]),
  read(/^\/api\/tmux-sessions$/),
  {
    kind: "agent",
    method: "POST",
    path: /^\/api\/sessions$/,
    relay: true,
    maxBody: 64 * KIB,
    headMs: HEAD_MS,
    body: startBody,
    action: "start",
  },
  read(session("reply-context")),
  read(session("prompt")),
  read(session("preview")),
  {
    kind: "agent",
    method: "POST",
    path: session("send-keys"),
    relay: true,
    maxBody: 256 * KIB,
    headMs: HEAD_MS,
    body: messageBody,
    action: "message",
  },
  {
    kind: "agent",
    method: "POST",
    path: session("prompt"),
    relay: true,
    maxBody: 4 * KIB,
    headMs: HEAD_MS,
    body: answerBody,
    action: "answer",
  },
  {
    kind: "agent",
    method: "POST",
    path: session("interrupt"),
    relay: true,
    maxBody: 0,
    headMs: HEAD_MS,
    action: "interrupt",
  },
  {
    kind: "agent",
    method: "POST",
    path: session("stop"),
    relay: true,
    maxBody: 0,
    headMs: HEAD_MS,
    action: "stop",
  },
];
