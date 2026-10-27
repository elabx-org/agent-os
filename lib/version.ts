import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

/**
 * The version this server runs: its release tag (CI tags each merge to
 * main, v0.5.3), else package.json's with the commit (0.5.0+1a2b3c4) for a
 * checkout that isn't a release. Read once: a deploy restarts the server.
 */
export const VERSION = (() => {
  const git = (...args: string[]) => {
    try {
      return execFileSync("git", args, {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      return "";
    }
  };
  const tag = git("describe", "--tags", "--exact-match", "--match", "v*");
  if (tag) return tag.replace(/^v/, "");
  let base = "0.0.0";
  try {
    base = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")
    ).version;
  } catch {}
  const sha = git("rev-parse", "--short", "HEAD");
  return sha ? `${base}+${sha}` : base;
})();
