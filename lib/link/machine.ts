/**
 * Machine mode: this AgentOS is linked to a hub. Present when
 * $AGENT_OS_HOME/link.json exists (written by `agent-os link`). The
 * server then listens on loopback only and keeps a link open to the hub
 * (lib/link/client.ts); where it stands is mirrored to link-state.json
 * for the command line.
 */

import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { USER_PROOF_COOKIE, userSecret } from "../user-proof";
import { LinkClient, type LinkState } from "./client";
import { generateMachineKey, isPublicKey, type MachineKey } from "./keys";
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

export const home = () =>
  process.env.AGENT_OS_HOME || path.join(os.homedir(), ".agent-os");
export const linkConfigPath = () => path.join(home(), "link.json");
export const linkStatePath = () => path.join(home(), "link-state.json");
const keyFilePath = () => path.join(home(), "link.key");

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

// --- The machine's key: the macOS Keychain, or a private file elsewhere ---

const KEYCHAIN_SERVICE = "agentos-link";

function keychain(args: string[], input?: string): string {
  return execFileSync("/usr/bin/security", args, {
    encoding: "utf8",
    input,
    stdio: ["pipe", "pipe", "ignore"],
  }).trim();
}

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

/** A stored secret for this hub (the key, or sign-in tokens), or null */
export function readSecret(account: string): string | null {
  if (process.platform === "darwin") {
    try {
      return keychain([
        "find-generic-password",
        "-s",
        KEYCHAIN_SERVICE,
        "-a",
        account,
        "-w",
      ]);
    } catch {
      return null;
    }
  }
  try {
    const all = JSON.parse(fs.readFileSync(keyFilePath(), "utf8")) as Record<
      string,
      string
    >;
    return all[account] ?? null;
  } catch {
    return null;
  }
}

export function writeSecret(account: string, value: string): void {
  if (process.platform === "darwin") {
    // Through stdin so the secret is never in a process's arguments
    const quote = (s: string) => `"${s.replace(/(["\\])/g, "\\$1")}"`;
    keychain(
      ["-i"],
      `add-generic-password -U -s ${quote(KEYCHAIN_SERVICE)} -a ${quote(account)} -w ${quote(value)}\n`
    );
    return;
  }
  let all: Record<string, string> = {};
  try {
    all = JSON.parse(fs.readFileSync(keyFilePath(), "utf8"));
  } catch {
    // first secret
  }
  all[account] = value;
  fs.mkdirSync(home(), { recursive: true });
  fs.writeFileSync(keyFilePath(), JSON.stringify(all), { mode: 0o600 });
  fs.chmodSync(keyFilePath(), 0o600);
}

export function deleteSecret(account: string): void {
  if (process.platform === "darwin") {
    try {
      keychain([
        "delete-generic-password",
        "-s",
        KEYCHAIN_SERVICE,
        "-a",
        account,
      ]);
    } catch {
      // wasn't there
    }
    return;
  }
  try {
    const all = JSON.parse(fs.readFileSync(keyFilePath(), "utf8")) as Record<
      string,
      string
    >;
    delete all[account];
    fs.writeFileSync(keyFilePath(), JSON.stringify(all), { mode: 0o600 });
  } catch {
    // wasn't there
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
  at: number;
}

function writeState(config: LinkConfig, state: LinkState): void {
  const hubSha = state.status === "linked" ? state.hubSha : null;
  const mine = ownSha();
  const file: LinkStatusFile = {
    hubUrl: config.hubUrl,
    name: config.name,
    state,
    updateTo: hubSha && mine && hubSha !== mine ? hubSha : null,
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

let running: LinkClient | null = null;

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
    onState: (state) => {
      writeState(config, state);
      console.log(
        `[link] ${state.status}${"reason" in state ? `: ${state.reason}` : ""}${state.status === "pending" ? ` (code ${state.code})` : ""}`
      );
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
  client.start();
  return client;
}
