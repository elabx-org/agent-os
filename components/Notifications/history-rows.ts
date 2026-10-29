/**
 * What Needs you shows, apart from React: the history's rows as E-NeedsYou
 * words them ("Agent control MCP finished", "agent-os · answered · 3h"),
 * grouped by day, and a waiting prompt as one question line. Client-safe.
 */

import { shortAge } from "@/lib/agent-state";
import type { NotificationEntry } from "@/lib/push/history";
import type { PermissionPrompt } from "@/lib/permission-prompt";

/** The row's 30px tile: green check, amber !, or a bell */
export type HistoryTile = "done" | "needs" | "bell";

export function historyTile(
  entry: Pick<NotificationEntry, "kind">
): HistoryTile {
  switch (entry.kind) {
    case "finished":
    case "agentFinished":
      return "done";
    case "needsYou":
    case "agentNeedsYou":
    case "limited":
      return "needs";
    case "resumed":
    case "settled":
      return "done";
    default:
      return "bell";
  }
}

// The watcher's titles: "Needs you · <project> · <session>",
// "Finished · <session>", "Settled · <project> · <session>" (M8), an
// agent's "<State> · <project>"
const PREFIX = /^([^·]+?) · (.+)$/;
const AGENT_WAITING = / is waiting for you$/;

/** What the row is about, in the mock's words: "<name> finished" */
export function historyTitle(entry: NotificationEntry): string {
  const m = PREFIX.exec(entry.title);
  if (!m) return entry.title;
  const [, head, rest] = m;
  const verb =
    entry.kind === "needsYou" || entry.kind === "agentNeedsYou"
      ? "asked"
      : entry.kind === "settled"
        ? "settled"
        : head.toLowerCase();
  if (entry.agentId) {
    // The agent's name leads the body: "<name> is waiting for you",
    // "<name>: <reply>" or just "<name>"
    const name = entry.body.replace(AGENT_WAITING, "").split(": ")[0];
    return `${name || "Background agent"} ${verb}`;
  }
  const project = entry.projectName;
  const name =
    project && rest.startsWith(`${project} · `)
      ? rest.slice(project.length + 3)
      : rest;
  return `${name} ${verb}`;
}

/** "3h", "2d": the mocks' short age */
export { shortAge as shortAgo };

/** A channel that failed is worth saying; one that worked isn't */
function failedChannels(entry: NotificationEntry): string | null {
  const { ntfy, apns } = entry.delivered ?? {};
  const failed = [
    ntfy && ntfy !== "sent" && "ntfy",
    apns && !/\bsent\b/.test(apns) && "Apple push",
  ].filter(Boolean);
  return failed.length ? `${failed.join(" and ")} failed` : null;
}

/**
 * "agent-os · answered · 3h": the project ("background" for an agent
 * outside every project), whether a prompt has been dealt with, failed
 * channels, the age. A title the watcher didn't write keeps its body
 */
export function historySubline(
  entry: NotificationEntry,
  {
    answered = false,
    now = Date.now(),
  }: { answered?: boolean; now?: number } = {}
): string {
  const known = PREFIX.test(entry.title);
  const where = entry.projectName ?? (entry.agentId ? "background" : null);
  return [
    known ? where : entry.body,
    answered && historyTile(entry) === "needs" ? "answered" : null,
    failedChannels(entry),
    shortAge(entry.at, now),
  ]
    .filter(Boolean)
    .join(" · ");
}

export interface HistoryDay {
  title: string;
  entries: NotificationEntry[];
}

const DAY_MS = 24 * 60 * 60_000;

/** "Earlier today", "Yesterday", "Earlier", newest first; empty days left out */
export function historyDays(
  entries: NotificationEntry[],
  now = Date.now()
): HistoryDay[] {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const today = midnight.getTime();
  const days: HistoryDay[] = [
    { title: "Earlier today", entries: [] },
    { title: "Yesterday", entries: [] },
    { title: "Earlier", entries: [] },
  ];
  for (const entry of entries) {
    const day = entry.at >= today ? 0 : entry.at >= today - DAY_MS ? 1 : 2;
    days[day].entries.push(entry);
  }
  return days.filter((d) => d.entries.length > 0);
}

/**
 * A prompt as the card's question: a command as "Run <code>?" (the code
 * part set in mono), else the prompt's own question, else its title
 */
export function askLine(
  prompt: Pick<PermissionPrompt, "title" | "detail" | "question">
): { text: string; code?: string; after?: string } {
  const command = prompt.detail.split("\n")[0].trim();
  if (command && /^bash command$/i.test(prompt.title))
    return { text: "Run ", code: command, after: "?" };
  return { text: prompt.question || prompt.title };
}
