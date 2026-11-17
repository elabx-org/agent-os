/**
 * Where a linked machine keeps its secrets (its key, its sign-in tokens):
 * the macOS Keychain, or a private file on other systems.
 */

import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

export const home = () =>
  process.env.AGENT_OS_HOME || path.join(os.homedir(), ".agent-os");
const keyFilePath = () => path.join(home(), "link.key");

const KEYCHAIN_SERVICE = "agentos-link";

function keychain(args: string[], input?: string): string {
  return execFileSync("/usr/bin/security", args, {
    encoding: "utf8",
    input,
    stdio: ["pipe", "pipe", "ignore"],
  }).trim();
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
    if (Object.keys(all).length === 0)
      fs.rmSync(keyFilePath(), { force: true });
    else fs.writeFileSync(keyFilePath(), JSON.stringify(all), { mode: 0o600 });
  } catch {
    // wasn't there
  }
}
