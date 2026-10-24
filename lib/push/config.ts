/**
 * Phone notification settings, kept in $AGENT_OS_HOME/push.json (mode 600):
 * which events notify, ntfy, and APNs for the iOS app.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { randomBytes } from "crypto";

export interface PushDevice {
  token: string;
  /** Learned on first send: development-signed apps use the APNs sandbox */
  sandbox?: boolean;
  addedAt: string;
}

export interface PushConfig {
  events: { needsYou: boolean; finished: boolean };
  /** Where notification links open, e.g. https://agent.example.com */
  publicUrl: string;
  ntfy: { enabled: boolean; server: string; topic: string; token: string };
  apns: {
    enabled: boolean;
    teamId: string;
    keyId: string;
    bundleId: string;
  };
  devices: PushDevice[];
}

export function agentOsHome(): string {
  return process.env.AGENT_OS_HOME || path.join(os.homedir(), ".agent-os");
}

const configFile = () => path.join(agentOsHome(), "push.json");
export const apnsKeyFile = () => path.join(agentOsHome(), "apns-key.p8");

function defaults(): PushConfig {
  return {
    events: { needsYou: true, finished: true },
    publicUrl: "",
    ntfy: {
      enabled: false,
      server: "https://ntfy.sh",
      // Topics on a public server are readable by anyone who knows the name
      topic: `agent-os-${randomBytes(12).toString("hex")}`,
      token: "",
    },
    apns: {
      enabled: false,
      teamId: "",
      keyId: "",
      bundleId: "org.elabx.agentos",
    },
    devices: [],
  };
}

export function readPushConfig(): PushConfig {
  const base = defaults();
  let stored: Partial<PushConfig> = {};
  try {
    stored = JSON.parse(fs.readFileSync(configFile(), "utf8"));
  } catch {
    // First use: save the defaults so the generated topic stays put
    writePushConfig(base);
    return base;
  }
  return {
    ...base,
    ...stored,
    events: { ...base.events, ...stored.events },
    ntfy: { ...base.ntfy, ...stored.ntfy },
    apns: { ...base.apns, ...stored.apns },
    devices: stored.devices ?? [],
  };
}

export function writePushConfig(config: PushConfig): void {
  fs.mkdirSync(agentOsHome(), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(config, null, 2) + "\n", {
    mode: 0o600,
  });
}

export function hasApnsKey(): boolean {
  return fs.existsSync(apnsKeyFile());
}

export function writeApnsKey(pem: string): void {
  fs.mkdirSync(agentOsHome(), { recursive: true });
  fs.writeFileSync(apnsKeyFile(), pem.trim() + "\n", { mode: 0o600 });
}

/** What each open page shows, shared between the watcher (server.ts) and API routes (Next's bundle) */
interface Presence {
  sessionId: string | null;
  visible: boolean;
  at: number;
}
const shared = globalThis as unknown as {
  __agentosPresence?: Map<string, Presence>;
};
const presence = () => (shared.__agentosPresence ??= new Map());

export function setPresence(
  clientId: string,
  sessionId: string | null,
  visible: boolean
) {
  presence().set(clientId, { sessionId, visible, at: Date.now() });
}

/** Someone is looking at this session right now, in the app or a browser */
export function isWatching(sessionId: string): boolean {
  const now = Date.now();
  for (const [id, p] of presence()) {
    if (now - p.at > 45_000) presence().delete(id);
    else if (p.visible && p.sessionId === sessionId) return true;
  }
  return false;
}
