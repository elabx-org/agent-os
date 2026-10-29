/**
 * Flag names, defaults and labels, with no server imports so the Labs
 * section can use them. lib/flags.ts re-exports these and reads the values.
 */

export const FLAG_NAMES = [
  "queue",
  "snapshots",
  "limits",
  "autoResume",
  "autoSettle",
  "searchIndex",
  "prPoller",
  "chatDefault",
  "liveFullAccess",
  "modeAtIdle",
  "bgSendCleanup",
] as const;

export type FlagName = (typeof FLAG_NAMES)[number];

export type Flags = Record<FlagName, boolean>;

/** Flags that start a background ticker (forced off by AGENTOS_DISABLE_TICKERS) */
export const TICKER_FLAGS: readonly FlagName[] = [
  "queue",
  "snapshots",
  "limits",
  "autoResume",
  "autoSettle",
  "searchIndex",
  "prPoller",
  "modeAtIdle",
];

export const FLAG_DEFAULTS: Flags = {
  queue: false,
  snapshots: false,
  limits: false,
  autoResume: false,
  autoSettle: false,
  searchIndex: false,
  prPoller: false,
  chatDefault: false,
  liveFullAccess: false,
  modeAtIdle: false,
  // M10: on, so "Send and start a new session" doesn't litter Now; Labs
  // turns it off (fresh sessions are then kept)
  bgSendCleanup: true,
};

export const FLAGS_PREFERENCE_KEY = "flags";

/**
 * Per-session overrides (preference key "flagSessions"): a flag that is off
 * can be switched on for listed sessions only, e.g. the queue on one
 * non-critical live session before everywhere
 */
export const FLAG_SESSIONS_PREFERENCE_KEY = "flagSessions";

/** The flags that take a per-session override */
export const SESSION_FLAGS = [
  "queue",
  "snapshots",
] as const satisfies readonly FlagName[];

export type SessionFlagName = (typeof SESSION_FLAGS)[number];

export type FlagSessions = Partial<Record<SessionFlagName, string[]>>;

/** Known flags' lists of session ids from a stored value */
export function parseFlagSessions(value: unknown): FlagSessions {
  const out: FlagSessions = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return out;
  const stored = value as Record<string, unknown>;
  for (const name of SESSION_FLAGS) {
    const ids = stored[name];
    if (Array.isArray(ids))
      out[name] = ids.filter((id): id is string => typeof id === "string");
  }
  return out;
}

/** What the Labs section shows for each flag */
export const FLAG_LABELS: Record<FlagName, { label: string; hint: string }> = {
  queue: {
    label: "Message queue",
    hint: "Holds messages until the session is ready for them",
  },
  snapshots: {
    label: "Turn snapshots",
    hint: "Records each turn's changes so it can be undone",
  },
  limits: {
    label: "Usage limits",
    hint: "Marks sessions that hit a usage limit and holds messages until it resets",
  },
  autoResume: {
    label: "Auto-resume",
    hint: "Resumes sessions when a usage limit resets",
  },
  autoSettle: {
    label: "Auto-settle",
    hint: "Settles idle sessions once their PR is merged",
  },
  searchIndex: {
    label: "Search index",
    hint: "Indexes transcripts in the background",
  },
  prPoller: {
    label: "PR checks",
    hint: "Polls GitHub for the PR of each session's branch",
  },
  chatDefault: {
    label: "Open sessions in chat",
    hint: "Off opens them in the terminal",
  },
  liveFullAccess: {
    label: "Instant full access",
    hint: "Full access joins Shift+Tab, so an agent could switch it on. New sessions only",
  },
  modeAtIdle: {
    label: "Permission changes wait for the turn",
    hint: "A mode picked mid-turn applies when the turn ends. Off applies it at once",
  },
  bgSendCleanup: {
    label: "Remove unused new sessions",
    hint: "A session opened by Send and start a new session is deleted when left without a message",
  },
};

/** Known boolean flags from a stored value, the rest from the defaults */
export function parseFlags(value: unknown): Flags {
  const flags = { ...FLAG_DEFAULTS };
  if (!value || typeof value !== "object" || Array.isArray(value)) return flags;
  const stored = value as Record<string, unknown>;
  for (const name of FLAG_NAMES) {
    if (typeof stored[name] === "boolean") flags[name] = stored[name];
  }
  return flags;
}
