import { NextRequest, NextResponse } from "next/server";
import { getProject } from "@/lib/projects";
import { userOnly } from "@/lib/permission-guard";
import { requireUser } from "@/lib/user-proof";
import {
  isTrusted,
  projectConfigResponse,
  setProjectFullAccess,
  trustConfig,
  writeProjectConfig,
  readProjectConfig,
  type AgentOsConfig,
  type ConfigConflictError,
  type PutProjectConfigResponse,
} from "@/lib/project-config";

type Params = { params: Promise<{ id: string }> };

/** The project, or the error response (404 missing, 400 uncategorized) */
function projectOr(id: string) {
  const project = getProject(id);
  if (!project) {
    return {
      error: NextResponse.json({ error: "Project not found" }, { status: 404 }),
    };
  }
  if (project.is_uncategorized) {
    return {
      error: NextResponse.json(
        { error: "Uncategorized has no folder or config" },
        { status: 400 }
      ),
    };
  }
  return { project };
}

/** Why a config body can't be written, or null */
function invalid(config: unknown): string | null {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return "config must be an object";
  }
  const { scripts, setup } = config as AgentOsConfig;
  if (scripts !== undefined) {
    if (!Array.isArray(scripts)) return "scripts must be a list";
    for (const s of scripts) {
      if (
        !s ||
        typeof s !== "object" ||
        typeof s.name !== "string" ||
        !s.name.trim() ||
        typeof s.command !== "string" ||
        !s.command.trim()
      ) {
        return "every script needs a name and a command";
      }
      if (s.in !== undefined && s.in !== "terminal" && s.in !== "background") {
        return `script "${s.name}": in must be terminal or background`;
      }
    }
  }
  if (
    setup !== undefined &&
    (!Array.isArray(setup) || setup.some((c) => typeof c !== "string"))
  ) {
    return "setup must be a list of commands";
  }
  return null;
}

// GET /api/projects/[id]/config - ProjectConfigResponse
export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const found = projectOr(id);
  if (found.error) return found.error;
  try {
    return NextResponse.json(await projectConfigResponse(id));
  } catch (error) {
    console.error("Error reading project config:", error);
    return NextResponse.json(
      { error: "Failed to read project config" },
      { status: 500 }
    );
  }
}

// PUT {config, baseHash, allowFullAccess?} - {hash, trusted}; requireUser;
// 409 ConfigConflictError when the file moved. The saved file is trusted
// only if the one it started from was: a save that changes one field must
// not approve commands someone else put in the file. allowFullAccess is
// kept in the DB, never in the file, and only changes when sent
export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const proof = requireUser(request);
  if (!proof.ok) return userOnly(proof.reason);
  const found = projectOr(id);
  if (found.error) return found.error;

  const body = await request.json().catch(() => null);
  const problem = body ? invalid(body.config) : "Invalid JSON";
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  if (typeof body.baseHash !== "string") {
    return NextResponse.json({ error: "baseHash required" }, { status: 400 });
  }

  const dir = found.project.working_directory;
  try {
    const wasTrusted = isTrusted(id, body.baseHash);
    const written = await writeProjectConfig(dir, body.config, body.baseHash);
    if (!written) {
      const conflict: ConfigConflictError = {
        error: "conflict",
        hash: (await readProjectConfig(dir)).hash,
      };
      return NextResponse.json(conflict, { status: 409 });
    }
    if (wasTrusted) trustConfig(id, written.hash);
    const config = body.config as AgentOsConfig;
    if (typeof body.allowFullAccess === "boolean") {
      setProjectFullAccess(
        id,
        body.allowFullAccess &&
          config.defaults?.permissionMode === "bypassPermissions"
      );
    }
    const response: PutProjectConfigResponse = {
      hash: written.hash,
      trusted: isTrusted(id, written.hash),
    };
    return NextResponse.json(response);
  } catch (error) {
    console.error("Error writing project config:", error);
    return NextResponse.json(
      { error: `Failed to write: ${(error as Error).message}` },
      { status: 500 }
    );
  }
}
