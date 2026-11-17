/**
 * `agent-os link ...` on a machine being linked to a hub: the parts that
 * need the app's own code (the invite, the key, the sign-in, the state).
 * scripts/agentos-machine.sh runs this with tsx and does the rest.
 *
 *   setup <invite>   save the hub's address, make this machine's key, sign in
 *   signin           sign in again (the stored sign-in ran out)
 *   wait             show where the link stands until it's approved
 *   status           one line: where the link stands
 *   forget           remove the key, the sign-in and the link settings
 */

import { execFileSync, spawn } from "child_process";
import fs from "fs";
import os from "os";
import { decodeInvite } from "../lib/link/hub-config";
import { matchCode } from "../lib/link/keys";
import {
  keyAccount,
  linkConfigPath,
  linkStatePath,
  loadOrCreateKey,
  readLinkConfig,
  writeLinkConfig,
  type LinkStatusFile,
} from "../lib/link/machine";
import { deleteSecret } from "../lib/link/secrets";
import { forgetSignIn, interactiveSignIn } from "../lib/link/signin";

const say = (text: string): void => {
  process.stdout.write(text + "\n");
};
const fail = (text: string): never => {
  process.stderr.write(text + "\n");
  process.exit(1);
};

function machineName(): string {
  if (process.env.AGENTOS_MACHINE_NAME) return process.env.AGENTOS_MACHINE_NAME;
  if (process.platform === "darwin") {
    try {
      return execFileSync("/usr/sbin/scutil", ["--get", "ComputerName"], {
        encoding: "utf8",
      }).trim();
    } catch {
      // fall through
    }
  }
  return os.hostname().replace(/\.local$/, "");
}

function openInBrowser(url: string): void {
  say("");
  say("Opening your browser to sign in. If it doesn't open, go to:");
  say(`  ${url}`);
  say("");
  if (process.platform === "darwin") {
    spawn("/usr/bin/open", [url], { stdio: "ignore", detached: true }).unref();
  }
}

async function signIn(): Promise<void> {
  const config = readLinkConfig();
  if (!config) return fail("This machine isn't set up to link yet.");
  if (!config.signIn) return say("No sign-in is needed for this AgentOS.");
  await interactiveSignIn(config.hubUrl, config.signIn, openInBrowser);
  say("Signed in.");
}

async function setup(invite: string | undefined): Promise<void> {
  const decoded = invite ? decodeInvite(invite) : null;
  if (!decoded) {
    return fail(
      "That command is incomplete or out of date. Copy a fresh one from AgentOS: Settings, Machines, Add a Mac."
    );
  }
  writeLinkConfig({
    hubUrl: decoded.hubUrl,
    name: machineName(),
    code: decoded.code,
    signIn: decoded.signIn,
  });
  const key = loadOrCreateKey(decoded.hubUrl);
  say(`Linking "${machineName()}" to ${new URL(decoded.hubUrl).host}`);
  say(`This machine's code: ${matchCode(key.publicKey)}`);
  await signIn();
}

function readState(): LinkStatusFile | null {
  try {
    return JSON.parse(
      fs.readFileSync(linkStatePath(), "utf8")
    ) as LinkStatusFile;
  } catch {
    return null;
  }
}

function describe(file: LinkStatusFile | null): string {
  if (!file) return "Not connected yet";
  const { state } = file;
  switch (state.status) {
    case "linked":
      return `Linked to ${new URL(file.hubUrl).host}${file.updateTo ? " (updating to match it)" : ""}`;
    case "pending":
      return `Waiting for you to approve this machine in AgentOS (Settings, Machines). Code: ${state.code}`;
    case "signin":
      return "Sign-in needed: run  agent-os link signin";
    case "refused":
      return state.reason === "removed"
        ? "This machine was removed in AgentOS. Add it again from Settings, Machines."
        : `AgentOS turned this machine away: ${state.reason}`;
    case "offline":
      return state.reason === "paused"
        ? "Off: run  agent-os link on"
        : "Can't reach AgentOS right now; trying again";
    default:
      return "Connecting";
  }
}

async function wait(): Promise<void> {
  const until = Date.now() + 15 * 60_000;
  let last = "";
  while (Date.now() < until) {
    const file = readState();
    const line = describe(file);
    if (line !== last) {
      say(line);
      last = line;
    }
    const status = file?.state.status;
    if (status === "linked") return;
    if (status === "refused" || status === "signin") process.exit(2);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  fail(
    "Still waiting. This machine keeps trying; approve it in AgentOS when you're ready."
  );
}

function forget(): void {
  const config = readLinkConfig();
  if (config) {
    deleteSecret(keyAccount(config.hubUrl));
    forgetSignIn(config.hubUrl);
  }
  for (const file of [linkConfigPath(), linkStatePath()]) {
    fs.rmSync(file, { force: true });
  }
  say("This machine's key, sign-in and link settings are removed.");
}

const [command, argument] = process.argv.slice(2);
const run: Record<string, () => Promise<void> | void> = {
  setup: () => setup(argument),
  signin: signIn,
  wait,
  status: () => say(describe(readState())),
  forget,
};
Promise.resolve(
  (run[command] ?? (() => fail(`Unknown command: ${command ?? ""}`)))()
).catch((error: Error) => fail(`Didn't work: ${error.message}`));
