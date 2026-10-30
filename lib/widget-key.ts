/**
 * The key a Home Screen widget sends to read GET /api/widget. A widget has
 * no sign-in cookie, so that one path skips sign-in (lib/auth.ts isPublic)
 * and checks this key instead. Kept in $AGENT_OS_HOME/widget-key (mode 600),
 * made on first use; a new key stops every widget holding the old one.
 */

import { randomBytes, timingSafeEqual } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

function keyFile(): string {
  const home =
    process.env.AGENT_OS_HOME || path.join(os.homedir(), ".agent-os");
  return path.join(home, "widget-key");
}

function write(key: string): string {
  const file = keyFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, key + "\n", { mode: 0o600 });
  return key;
}

function read(): string | null {
  try {
    return fs.readFileSync(keyFile(), "utf8").trim() || null;
  } catch {
    return null;
  }
}

/** The current key, made if there's none yet */
export function widgetKey(): string {
  return read() ?? write(randomBytes(24).toString("base64url"));
}

/** A fresh key: widgets with the old one get 401 until they're given this */
export function newWidgetKey(): string {
  return write(randomBytes(24).toString("base64url"));
}

/** Never makes a key: with none on disk nothing matches */
export function isWidgetKey(given: string | null | undefined): boolean {
  const key = read();
  if (!key || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}
