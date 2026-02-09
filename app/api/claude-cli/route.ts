import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";

/**
 * POST /api/claude-cli
 *
 * Whitelisted endpoint for running `claude` CLI subcommands.
 * Only allows: mcp add, mcp remove
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, args } = body as {
      action: string;
      args: Record<string, unknown>;
    };

    if (!action) {
      return NextResponse.json({ error: "action is required" }, { status: 400 });
    }

    let command: string;

    switch (action) {
      case "mcp-add": {
        const { name, scope, command: cmd, cmdArgs, env } = args as {
          name: string;
          scope: string;
          command: string;
          cmdArgs?: string[];
          env?: Record<string, string>;
        };
        if (!name || !cmd) {
          return NextResponse.json(
            { error: "name and command are required for mcp-add" },
            { status: 400 }
          );
        }

        const parts = ["claude", "mcp", "add", "-s", scope || "user"];
        if (env) {
          for (const [key, val] of Object.entries(env)) {
            parts.push("-e", `${key}=${val}`);
          }
        }
        parts.push("--", name, cmd);
        if (cmdArgs && cmdArgs.length > 0) {
          parts.push(...cmdArgs);
        }
        command = parts.map(shellEscape).join(" ");
        break;
      }

      case "mcp-remove": {
        const { name, scope } = args as { name: string; scope: string };
        if (!name) {
          return NextResponse.json(
            { error: "name is required for mcp-remove" },
            { status: 400 }
          );
        }
        command = ["claude", "mcp", "remove", "-s", scope || "user", name]
          .map(shellEscape)
          .join(" ");
        break;
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}. Allowed: mcp-add, mcp-remove` },
          { status: 400 }
        );
    }

    try {
      const output = execSync(command, {
        encoding: "utf-8",
        timeout: 15000,
        shell: "/bin/bash",
      });
      return NextResponse.json({ success: true, output: output.trim() });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Command failed";
      return NextResponse.json({ success: false, output: msg }, { status: 500 });
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid request" },
      { status: 400 }
    );
  }
}

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
