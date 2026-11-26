import { randomBytes } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * How long a line the server types into a terminal's shell may be. A
 * terminal keeps only so much typed text while nothing reads it (a shell
 * still starting): macOS 1024 bytes, Linux 4096. What is over is dropped
 * without a word, the Enter with it, so the line never runs.
 */
export const TYPED_LINE_MAX = 900;

const shellQuote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;

/** Writes `command` to a file that removes itself as it runs; its path */
function writeLineFile(command: string): string {
  const file = path.join(
    os.tmpdir(),
    `agent-os-line-${randomBytes(9).toString("base64url")}.sh`
  );
  fs.writeFileSync(file, `rm -f -- ${shellQuote(file)}\n${command}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  return file;
}

/**
 * What to type so `command` runs in the shell: the command itself, or for
 * one too long to type, a short line that runs it from a file (in the same
 * shell, so what it starts takes the terminal as if typed).
 */
export function typedLine(
  command: string,
  write: (command: string) => string = writeLineFile
): string {
  if (Buffer.byteLength(command) <= TYPED_LINE_MAX) return command;
  try {
    return `. ${shellQuote(write(command))}`;
  } catch {
    // No file to be had: typed whole, as before
    return command;
  }
}
