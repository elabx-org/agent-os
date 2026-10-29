import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/**
 * The repo a folder belongs to: its git common dir, resolved through
 * symlinks so every worktree of one repo gives the same key. Null when it
 * isn't a repo
 */
export async function gitCommonDir(dir: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["rev-parse", "--git-common-dir"],
      { cwd: dir, timeout: 5000 }
    );
    const out = stdout.trim();
    if (!out) return null;
    const common = path.resolve(dir, out);
    return await fs.promises.realpath(common).catch(() => common);
  } catch {
    return null;
  }
}
