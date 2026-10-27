import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const run = promisify(execFile);

/**
 * Registers `agent-os mcp` with the agent CLIs installed here (Claude Code,
 * Codex, Gemini CLI) so any of them can drive Agent-OS, on fresh installs and
 * after updates alike. Only adds what's missing: a registration someone made
 * or changed by hand is left alone. AGENTOS_MCP_REGISTER=0 turns it off.
 */
export async function registerMcp(port: number): Promise<void> {
  if (process.env.AGENTOS_MCP_REGISTER === "0") return;
  // Only the real install: a second server (a test build, another home)
  // mustn't point everyone's agents at itself
  const home =
    process.env.AGENT_OS_HOME || path.join(os.homedir(), ".agent-os");
  if (path.resolve(home) !== path.join(os.homedir(), ".agent-os")) return;

  const env = {
    ...process.env,
    PATH: [
      path.join(os.homedir(), ".local/bin"),
      path.join(os.homedir(), ".npm-global/bin"),
      "/config/.npm-global/bin",
      process.env.PATH,
    ].join(":"),
  };
  const which = async (bin: string) => {
    try {
      return (
        await run("bash", ["-c", `command -v ${bin}`], { env })
      ).stdout.trim();
    } catch {
      return null;
    }
  };

  // This install's own launcher: its path holds across updates, and another
  // agent-os on PATH (an older npm install) may not have `mcp`
  const launcher = path.join(process.cwd(), "scripts", "agent-os");
  if (!fs.existsSync(launcher)) return;
  const url = port === 3011 ? null : `http://localhost:${port}`;

  const clis: {
    bin: string;
    has: string[];
    add: string[];
    present?: (out: string) => boolean;
  }[] = [
    {
      bin: "claude",
      has: ["mcp", "get", "agent-os"],
      add: [
        "mcp",
        "add",
        "-s",
        "user",
        ...(url ? ["-e", `AGENTOS_URL=${url}`] : []),
        "agent-os",
        "--",
        launcher,
        "mcp",
      ],
    },
    {
      bin: "codex",
      has: ["mcp", "get", "agent-os"],
      add: [
        "mcp",
        "add",
        ...(url ? ["--env", `AGENTOS_URL=${url}`] : []),
        "agent-os",
        "--",
        launcher,
        "mcp",
      ],
    },
    {
      bin: "gemini",
      has: ["mcp", "list"],
      present: (out) => /\bagent-os\b/.test(out),
      add: [
        "mcp",
        "add",
        "-s",
        "user",
        ...(url ? ["-e", `AGENTOS_URL=${url}`] : []),
        "agent-os",
        launcher,
        "mcp",
      ],
    },
  ];

  for (const cli of clis) {
    const bin = await which(cli.bin);
    if (!bin) continue;
    try {
      const { stdout } = await run(bin, cli.has, { env, timeout: 20000 });
      if (!cli.present || cli.present(stdout)) continue;
    } catch {
      // Not registered (get exits non-zero)
    }
    try {
      await run(bin, cli.add, { env, timeout: 20000 });
      console.log(`[mcp] registered agent-os with ${cli.bin}`);
    } catch (error) {
      console.warn(`[mcp] couldn't register agent-os with ${cli.bin}:`, error);
    }
  }
}
