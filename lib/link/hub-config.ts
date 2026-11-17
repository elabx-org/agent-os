/**
 * What the hub tells a new machine: where the hub is and, when a sign-in
 * stands in front of it (e.g. Authelia), how to get through. The sign-in
 * part is $AGENT_OS_HOME/link-hub.json: { "signIn": { "issuer", "clientId" } }.
 */

import fs from "fs";
import os from "os";
import path from "path";
import type { SignInConfig } from "./signin";

export const INSTALL_SCRIPT_URL =
  "https://raw.githubusercontent.com/elabx-org/agent-os/main/scripts/link-machine.sh";

export interface Invite {
  hubUrl: string;
  code: string;
  signIn?: SignInConfig;
  /** The hub's commit, so the machine installs the same version */
  sha?: string | null;
}

export function hubSignIn(): SignInConfig | undefined {
  try {
    const home =
      process.env.AGENT_OS_HOME || path.join(os.homedir(), ".agent-os");
    const value = JSON.parse(
      fs.readFileSync(path.join(home, "link-hub.json"), "utf8")
    ) as { signIn?: SignInConfig };
    const signIn = value.signIn;
    if (
      signIn &&
      typeof signIn.clientId === "string" &&
      new URL(signIn.issuer).protocol === "https:"
    ) {
      return { issuer: signIn.issuer, clientId: signIn.clientId };
    }
  } catch {
    // No sign-in in front of this hub
  }
  return undefined;
}

export const encodeInvite = (invite: Invite) =>
  Buffer.from(JSON.stringify(invite)).toString("base64url");

export function decodeInvite(text: string): Invite | null {
  try {
    const value = JSON.parse(
      Buffer.from(text, "base64url").toString("utf8")
    ) as Invite;
    const url = new URL(value.hubUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (
      typeof value.code !== "string" ||
      !/^[A-Z0-9]{6,20}$/.test(value.code)
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

/** The one line the user pastes into the machine's terminal */
export const installCommand = (invite: Invite) =>
  `curl -fsSL ${INSTALL_SCRIPT_URL} | bash -s -- ${encodeInvite(invite)}`;
