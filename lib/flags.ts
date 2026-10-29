/**
 * Feature flags: kill switches for background work and risky behaviour,
 * stored in preferences (key "flags", JSON) and mirrored to
 * $AGENT_OS_HOME/flags.json for the Claude hook scripts.
 * AGENTOS_DISABLE_TICKERS=1 forces every ticker off.
 */

export const FLAG_NAMES = [
  "queue",
  "snapshots",
  "autoResume",
  "autoSettle",
  "searchIndex",
  "prPoller",
  "chatDefault",
  "liveFullAccess",
] as const;

export type FlagName = (typeof FLAG_NAMES)[number];

export type Flags = Record<FlagName, boolean>;

/** Flags that start a background ticker (forced off by AGENTOS_DISABLE_TICKERS) */
export const TICKER_FLAGS: readonly FlagName[] = [
  "queue",
  "snapshots",
  "autoResume",
  "autoSettle",
  "searchIndex",
  "prPoller",
];

export const FLAG_DEFAULTS: Flags = {
  queue: false,
  snapshots: false,
  autoResume: false,
  autoSettle: false,
  searchIndex: false,
  prPoller: false,
  chatDefault: false,
  liveFullAccess: false,
};

export const FLAGS_PREFERENCE_KEY = "flags";

export function tickersDisabled(): boolean {
  return process.env.AGENTOS_DISABLE_TICKERS === "1";
}

/** All flags, through a 5s cache shared by server.ts and Next */
export function getFlags(): Flags {
  return { ...FLAG_DEFAULTS };
}

export function getFlag(name: FlagName): boolean {
  return getFlags()[name];
}

/** Saves a change, refreshes the cache and the flags.json mirror */
export function setFlags(_patch: Partial<Flags>): Flags {
  throw new Error("not implemented");
}
