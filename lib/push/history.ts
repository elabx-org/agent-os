/**
 * Everything that needed you or happened lately, kept in
 * $AGENT_OS_HOME/notifications.json (mode 600) whether or not a push went
 * out. The watcher (server.ts) writes it and the API routes (Next's bundle)
 * read it, so the file is the only shared state: no module singletons.
 */

import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";
import { agentOsHome } from "./config";
import type { PushMessage, SendReport } from "./send";

const MAX_ITEMS = 200;

export interface NotificationEntry {
  id: string;
  kind: PushMessage["kind"];
  title: string;
  body: string;
  sessionId?: string;
  agentId?: string;
  projectName?: string;
  /** ms since epoch */
  at: number;
  /** What each channel did; empty when nothing was sent */
  delivered: SendReport;
  read: boolean;
}

interface HistoryFile {
  items: NotificationEntry[];
  /** When the list was last marked read as a whole */
  lastSeen: number;
}

const historyFile = () => path.join(agentOsHome(), "notifications.json");

function load(): HistoryFile {
  try {
    const stored = JSON.parse(fs.readFileSync(historyFile(), "utf8"));
    return {
      items: Array.isArray(stored.items) ? stored.items : [],
      lastSeen: typeof stored.lastSeen === "number" ? stored.lastSeen : 0,
    };
  } catch {
    return { items: [], lastSeen: 0 };
  }
}

// Through a temp file so a reader never sees half a write
function save(history: HistoryFile): void {
  fs.mkdirSync(agentOsHome(), { recursive: true });
  const tmp = `${historyFile()}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(history) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, historyFile());
}

/** Adds an entry, newest first, dropping the oldest past the limit */
export function recordNotification(
  entry: Omit<NotificationEntry, "id" | "at" | "delivered" | "read"> &
    Partial<Pick<NotificationEntry, "delivered" | "read">>
): NotificationEntry {
  const full: NotificationEntry = {
    id: randomBytes(6).toString("hex"),
    at: Date.now(),
    delivered: {},
    read: false,
    ...entry,
  };
  try {
    const history = load();
    history.items = [full, ...history.items].slice(0, MAX_ITEMS);
    save(history);
  } catch (error) {
    console.error("[push] history:", error);
  }
  return full;
}

/** Fills in what the channels did once the send settles */
export function setDelivered(id: string, delivered: SendReport): void {
  try {
    const history = load();
    const item = history.items.find((i) => i.id === id);
    if (!item) return;
    item.delivered = delivered;
    save(history);
  } catch (error) {
    console.error("[push] history:", error);
  }
}

export function listNotifications(opts: { since?: number } = {}) {
  const { items, lastSeen } = load();
  const since = opts.since ?? 0;
  return {
    items: items.filter((i) => i.at > since),
    unread: items.filter((i) => !i.read).length,
    lastSeen,
  };
}

export function markNotificationsRead(ids: string[] | "all"): void {
  const history = load();
  const wanted = ids === "all" ? null : new Set(ids);
  for (const item of history.items) {
    if (!wanted || wanted.has(item.id)) item.read = true;
  }
  if (!wanted) history.lastSeen = Date.now();
  save(history);
}

/**
 * Empties the history (Needs you → Clear history); what still waits is
 * the sessions' own state, so it stays. Seen as of now: nothing is unread
 */
export function clearNotifications(): void {
  save({ items: [], lastSeen: Date.now() });
}
