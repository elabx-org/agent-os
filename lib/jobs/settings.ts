/**
 * This machine's own say over the jobs it runs for its server: how much a
 * job's session may do without asking. Kept here, on the machine that runs
 * them, and changed only by the user (app/api/jobs/settings). Server only.
 */

import fs from "node:fs";
import path from "node:path";
import { home as agentOsHome } from "../link/secrets";
import { cleanJobMode, type JobMode } from "./types";

const file = () => path.join(agentOsHome(), "job-settings.json");

/** Ask first until the user says otherwise */
export function jobMode(): JobMode {
  try {
    const value = JSON.parse(fs.readFileSync(file(), "utf8")) as {
      mode?: unknown;
    };
    return cleanJobMode(value?.mode) ?? "manual";
  } catch {
    return "manual";
  }
}

export function setJobMode(mode: JobMode): void {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  const tmp = `${file()}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ mode }), { mode: 0o600 });
  fs.renameSync(tmp, file());
}
