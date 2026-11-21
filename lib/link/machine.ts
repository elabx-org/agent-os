/**
 * Machine mode: this AgentOS is linked to a hub. Present when
 * $AGENT_OS_HOME/link.json exists (written by `agent-os link`). The
 * server then listens on loopback only and keeps a link open to the hub
 * (lib/link/client.ts); where it stands is mirrored to link-state.json
 * for the command line.
 */

import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { USER_PROOF_COOKIE, userSecret } from "../user-proof";
import {
  LinkClient,
  UpUnavailable,
  type LinkState,
  type UpAnswer,
  type UpInit,
} from "./client";
import { CAP_UP, type LinkNotice, type UpAllowed } from "./protocol";
import { generateMachineKey, isPublicKey, type MachineKey } from "./keys";
import { home, readSecret, writeSecret } from "./secrets";
import { ownSha } from "./server";
import { signInHeaders, type SignInConfig } from "./signin";

export interface LinkConfig {
  /** The hub's address as the user opens it */
  hubUrl: string;
  name: string;
  /** One-time code from the hub; dropped after the first connection */
  code?: string;
  /** The sign-in in front of the hub, when there is one */
  signIn?: SignInConfig;
  /** true: stay disconnected until `agent-os link on` */
  paused?: boolean;
}

export const linkConfigPath = () => path.join(home(), "link.json");
export const linkStatePath = () => path.join(home(), "link-state.json");

export function readLinkConfig(): LinkConfig | null {
  try {
    const value = JSON.parse(
      fs.readFileSync(linkConfigPath(), "utf8")
    ) as LinkConfig;
    const url = new URL(value.hubUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return typeof value.name === "string" ? value : null;
  } catch {
    return null;
  }
}

export function writeLinkConfig(config: LinkConfig): void {
  fs.mkdirSync(home(), { recursive: true });
  fs.writeFileSync(linkConfigPath(), JSON.stringify(config, null, 2) + "\n", {
    mode: 0o600,
  });
}

export const isMachineMode = () => readLinkConfig() !== null;

// --- The machine's key ---

function parseKey(text: string): MachineKey | null {
  try {
    const key = JSON.parse(text) as MachineKey;
    return isPublicKey(key.publicKey) && typeof key.privateKey === "string"
      ? key
      : null;
  } catch {
    return null;
  }
}

export const keyAccount = (hubUrl: string) => `key:${new URL(hubUrl).host}`;

export function loadOrCreateKey(hubUrl: string): MachineKey {
  const account = keyAccount(hubUrl);
  const stored = readSecret(account);
  const existing = stored ? parseKey(stored) : null;
  if (existing) return existing;
  const key = generateMachineKey();
  writeSecret(account, JSON.stringify(key));
  return key;
}

// --- Running the link ---

export interface LinkStatusFile {
  hubUrl: string;
  name: string;
  state: LinkState;
  /** The hub runs a different commit: this copy should update to it */
  updateTo: string | null;
  /** What the hub lets this machine ask (lib/link/up.ts) */
  up?: { supported: boolean; agents: boolean; backup: boolean };
  at: number;
}

function writeState(
  config: LinkConfig,
  state: LinkState,
  up?: LinkStatusFile["up"]
): void {
  const hubSha = state.status === "linked" ? state.hubSha : null;
  const mine = ownSha();
  const file: LinkStatusFile = {
    hubUrl: config.hubUrl,
    name: config.name,
    state,
    updateTo: hubSha && mine && hubSha !== mine ? hubSha : null,
    up,
    at: Date.now(),
  };
  try {
    fs.writeFileSync(linkStatePath(), JSON.stringify(file, null, 2) + "\n", {
      mode: 0o600,
    });
  } catch {
    // The state file is a convenience
  }
}

let updating = false;

/** The hub runs another commit: switch this copy to it (scripts/agentos-machine.sh) */
function matchHub(sha: string): void {
  if (updating || !/^[0-9a-f]{40}$/.test(sha)) return;
  if (process.env.AGENTOS_LINK_NO_UPDATE === "1") return;
  updating = true;
  const script = path.join(process.cwd(), "scripts", "agentos-machine.sh");
  try {
    spawn("/bin/bash", [script, "update", sha], {
      detached: true,
      stdio: "ignore",
    }).unref();
    console.log(`[link] updating to the hub's version ${sha.slice(0, 7)}`);
  } catch {
    updating = false;
  }
}

// server.ts and the Next route bundles are separate module graphs in one
// process: the link lives on globalThis so routes can reach it
const shared = globalThis as typeof globalThis & {
  __agentosLinkClient?: LinkClient | null;
};

/** Whether the hub's sessions may use this machine; null when not linked */
export const hubAgents = (): boolean | null =>
  shared.__agentosLinkClient?.agents ?? null;

/** Asks the hub to change it; false when there's no link to ask over */
export const setHubAgents = (allowed: boolean): boolean =>
  shared.__agentosLinkClient?.setAgents(allowed) ?? false;

export { UpUnavailable, type UpAnswer, type UpInit };

const upFailed = (code: UpUnavailable["code"]) =>
  Promise.reject(new UpUnavailable(code));

/**
 * A session's call to the hub, marked as an agent's. Only the machine's
 * /api/hub route calls this.
 */
export function askHub(init: UpInit): Promise<UpAnswer> {
  const client = shared.__agentosLinkClient;
  return client ? client.up("agent", init) : upFailed("not_linked");
}

/**
 * AgentOS's own upload to the hub (copies of sessions). No HTTP route may
 * call this: a session must never be able to send as AgentOS.
 */
export function uploadToHub(init: UpInit): Promise<UpAnswer> {
  const client = shared.__agentosLinkClient;
  return client ? client.up("system", init) : upFailed("not_linked");
}

/** What the hub lets this machine ask, for its pages and tools */
export function hubUp(): {
  linked: boolean;
  supported: boolean;
  agents: boolean;
  backup: boolean;
  machineId: string | null;
  name: string | null;
  hubName: string | null;
} {
  const client = shared.__agentosLinkClient;
  const state = client?.state;
  const linked = state?.status === "linked";
  const up: UpAllowed | null = linked ? (client?.upAllowed ?? null) : null;
  return {
    linked,
    supported: linked && !!client?.hubCaps.has(CAP_UP),
    agents: up?.agents ?? false,
    backup: up?.backup ?? false,
    machineId: state?.status === "linked" ? state.machineId : null,
    name: up?.name || null,
    hubName: up?.hubName ?? null,
  };
}

const upState = (client: LinkClient): LinkStatusFile["up"] => ({
  supported: client.hubCaps.has(CAP_UP),
  agents: client.upAllowed?.agents ?? false,
  backup: client.upAllowed?.backup ?? false,
});

let running: LinkClient | null = null;

/**
 * A linked machine has no phone of its own: what its sessions want to say
 * goes to the hub, which notifies the way the user set it up there.
 * False when this isn't a linked machine or the link is down.
 */
export function notifyHub(notice: LinkNotice): boolean {
  return running?.notify(notice) ?? false;
}

/** server.ts, once listening: dials the hub when this is a linked machine */
export function startMachineLink(localPort: number): LinkClient | null {
  const config = readLinkConfig();
  if (!config || running) return running;
  if (config.paused) {
    writeState(config, { status: "offline", reason: "paused" });
    return null;
  }
  const client = new LinkClient({
    hubUrl: config.hubUrl,
    key: loadOrCreateKey(config.hubUrl),
    name: config.name,
    localPort,
    sha: ownSha(),
    code: config.code,
    authHeaders: config.signIn
      ? () => signInHeaders(config.hubUrl, config.signIn!)
      : undefined,
    userCookie: () => `${USER_PROOF_COOKIE}=${userSecret()}`,
    onUpAllowed: () => writeState(config, client.state, upState(client)),
    onState: (state) => {
      writeState(config, state, upState(client));
      console.log(
        `[link] ${state.status}${"reason" in state ? `: ${state.reason}` : ""}${state.status === "pending" ? ` (code ${state.code})` : ""}`
      );
      if (state.status === "linked" && state.hubSha) {
        const mine = ownSha();
        if (mine && mine !== state.hubSha) matchHub(state.hubSha);
      }
      // The one-time code has done its job
      if (
        (state.status === "pending" || state.status === "linked") &&
        config.code
      ) {
        delete config.code;
        const onDisk = readLinkConfig();
        if (onDisk?.code) {
          delete onDisk.code;
          writeLinkConfig(onDisk);
        }
      }
    },
  });
  running = client;
  shared.__agentosLinkClient = client;
  client.start();
  return client;
}
