import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getDb, queries, type Session, type Group } from "@/lib/db";
import { isValidAgentType, type AgentType } from "@/lib/providers";
import { getProviderDefinition } from "@/lib/providers/registry";
import { createWorktree } from "@/lib/worktrees";
import { generateBranchName } from "@/lib/git";
import { setupNativeWorktreeWhenReady, setupWorktree, type SetupResult } from "@/lib/env-setup";
import { resolveProjectDefaults, type ResolvedProjectDefaults } from "@/lib/project-config";
import { isSafeModelName } from "@/lib/model-name";
import { isClaudeModel } from "@/lib/handoff-types";
import { NO_CLAUDE_MODELS } from "@/lib/claude-models";
import { readClaudeModels } from "@/lib/claude-models-store";
import { findAvailablePort } from "@/lib/ports";
import { runInBackground } from "@/lib/async-operations";
import { getProject } from "@/lib/projects";
import { launchSession } from "@/lib/session-launch";
import { filterSettled } from "@/lib/settle";
import { parseSettledFilter } from "@/lib/settle-types";
import {
  announceFullAccess,
  grantFullAccess,
  requester,
} from "@/lib/permission-guard";
import { capForAgent, normalizeMode } from "@/lib/permission-mode";
import { fromMachine } from "@/lib/link/from-machine";
import {
  fromMachineRefusal,
  MAX_RUNNING_FROM_MACHINE,
  runningFrom,
} from "@/lib/from-machine-rules";
import { chainOf, MAX_CHAIN, type StartedBy } from "@/lib/session-started-by";
import { isMachineMode, hubUp } from "@/lib/link/machine";
import { machineById } from "@/lib/link/store";
import { isRunning } from "@/lib/session-launch";
import { safeBranch } from "@/lib/session-move-types";

// GET /api/sessions - List all sessions and groups
export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    // ?settled=0|1|today (M8); no parameter lists them all
    const sessions = filterSettled(
      queries.getAllSessions(db).all() as Session[],
      parseSettledFilter(request.nextUrl.searchParams.get("settled"))
    );
    const groups = queries.getAllGroups(db).all() as Group[];

    // Convert expanded from 0/1 to boolean
    const formattedGroups = groups.map((g) => ({
      ...g,
      expanded: Boolean(g.expanded),
    }));

    return NextResponse.json({ sessions, groups: formattedGroups });
  } catch (error) {
    console.error("Error fetching sessions:", error);
    return NextResponse.json(
      { error: "Failed to fetch sessions" },
      { status: 500 }
    );
  }
}

// Generate a unique session name
function generateSessionName(db: ReturnType<typeof getDb>): string {
  const sessions = queries.getAllSessions(db).all() as Session[];
  const existingNumbers = sessions
    .map((s) => {
      const match = s.name.match(/^Session (\d+)$/);
      return match ? parseInt(match[1], 10) : 0;
    })
    .filter((n) => n > 0);

  const nextNumber =
    existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1;
  return `Session ${nextNumber}`;
}

/** What this server calls the machine a request came from */
function machineName(from: string): string {
  if (isMachineMode()) {
    return from === "hub" ? hubUp().hubName || "the server" : "another machine";
  }
  return (from !== "hub" && machineById(from)?.name) || "another machine";
}

/**
 * A session on another machine asks: a Claude session that asks before
 * acting, in one of the projects here and in its folder, and nothing that
 * reaches a shell or a branch the caller names (lib/from-machine-rules.ts)
 */
function forMachine(body: Record<string, unknown>): Record<string, unknown> {
  const text = (value: unknown) => (typeof value === "string" ? value : null);
  return {
    name: text(body.name) ?? undefined,
    projectId: body.projectId,
    model: text(body.model) ?? undefined,
    initialPrompt: text(body.initialPrompt),
    useWorktree: body.useWorktree === true,
    featureName: text(body.featureName) || null,
    agentType: "claude",
    autoApprove: false,
    permissionMode: "manual",
    launch: body.launch === true,
  };
}

// POST /api/sessions - Create new session
export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const from = fromMachine(request);
    let body = await request.json();
    let startedBy: StartedBy | null = null;
    if (from) {
      body = forMachine(body ?? {});
      const project =
        typeof body.projectId === "string" ? getProject(body.projectId) : undefined;
      if (!project || project.is_uncategorized) {
        return fromMachineRefusal("project_required");
      }
      body.workingDirectory = project.working_directory;
      if (body.useWorktree && !safeBranch(body.featureName)) {
        return NextResponse.json(
          { error: "That branch name can't be used.", code: "bad_request" },
          { status: 400 }
        );
      }
      const sessions = queries.getAllSessions(db).all() as Session[];
      if ((await runningFrom(from, sessions, isRunning)) >= MAX_RUNNING_FROM_MACHINE) {
        return fromMachineRefusal("too_many_running");
      }
    }
    // Sessions starting each other across machines: one more hop. A start
    // from another machine is always marked, chain or not, so the running
    // cap above counts it
    const chain = chainOf(request) ?? (from ? 0 : null);
    if (chain !== null) {
      const depth = chain + 1;
      if (depth > MAX_CHAIN) return fromMachineRefusal("chain_too_deep");
      const machineId = from ?? "hub";
      startedBy = { machineId, machine: machineName(machineId), depth, at: Date.now() };
    }

    const {
      name: providedName,
      workingDirectory = "~",
      parentSessionId = null,
      model: requestedModel,
      systemPrompt = null,
      groupPath = "sessions",
      claudeSessionId = null,
      agentType: requestedAgentType,
      autoApprove: requestedAutoApprove = false,
      // lib/permission-mode.ts Mode; NULL keeps the agent's default
      permissionMode: requestedMode = null,
      projectId = "uncategorized",
      // Worktree options
      useWorktree = false,
      createBranch = false,
      featureName = null,
      baseBranch = "main",
      // Tmux option
      useTmux = true,
      // Continue last session in working directory
      continueSession = false,
      // Initial prompt to send when session starts
      initialPrompt = null,
      // Start it now, with nobody watching (agents driving AgentOS)
      launch = false,
    } = body;

    const id = randomUUID();

    // What the request leaves out comes from the project's .agent-os.json
    const projectDefaults = await resolveProjectDefaults(projectId).catch(
      () => ({}) as ResolvedProjectDefaults
    );
    const rawAgentType = requestedAgentType ?? projectDefaults.agent ?? "claude";
    // Claude's: Settings → Claude Code's defaults for new sessions
    const claudeModels =
      rawAgentType === "claude" ? readClaudeModels(db) : NO_CLAUDE_MODELS;
    // The file's model goes with the agent it names only
    const pickedModel =
      (requestedModel || undefined) ??
      (rawAgentType === projectDefaults.agent
        ? projectDefaults.model
        : undefined) ??
      claudeModels.model ??
      undefined;
    // "sonnet" not picked stands for Claude Code's own default (no --model)
    const model = pickedModel ?? "sonnet";
    if (!isSafeModelName(model)) {
      return NextResponse.json({ error: "Invalid model name" }, { status: 400 });
    }
    // Sub-agents: an alias, "same" (or null) for the session's own model;
    // left out, the default
    const requestedSubagents: unknown = body.subagentModel;
    if (
      requestedSubagents != null &&
      requestedSubagents !== "same" &&
      !isClaudeModel(requestedSubagents)
    ) {
      return NextResponse.json({ error: "Unknown sub-agent model" }, { status: 400 });
    }
    const subagentModel =
      rawAgentType !== "claude"
        ? null
        : requestedSubagents === undefined
          ? claudeModels.subagents
          : isClaudeModel(requestedSubagents)
            ? requestedSubagents
            : null;
    // The file's Full access (the user chose it in the UI) is the user's
    // own only: anyone else's request gets the capped mode, unrefused
    const defaultMode =
      requestedMode == null && body.autoApprove === undefined
        ? (projectDefaults.permissionMode ?? null)
        : null;

    // Skipping permission prompts is the user's call, never an agent's: an
    // agent's request is capped, one with neither proof nor agent markers
    // refused (lib/permission-guard.ts)
    const mode =
      normalizeMode(requestedMode) ??
      (defaultMode === "bypassPermissions" && requester(request).by !== "user"
        ? capForAgent(defaultMode)
        : defaultMode);
    const wantsFullAccess = mode
      ? mode === "bypassPermissions"
      : !!requestedAutoApprove;
    let granted = false;
    if (wantsFullAccess) {
      const { grant, refuse } = grantFullAccess(request, requester(request), {
        targetSessionId: id,
        action: "spawn",
        detail: "Full access",
      });
      if (refuse) return refuse;
      granted = grant;
    }
    const permissionMode = mode && !granted ? capForAgent(mode) : mode;
    const autoApprove = permissionMode
      ? permissionMode === "bypassPermissions"
      : !!requestedAutoApprove && granted;

    // Validate agent type
    const agentType: AgentType = isValidAgentType(rawAgentType)
      ? rawAgentType
      : "claude";

    // Auto-generate name if not provided
    const name =
      providedName?.trim() ||
      (featureName ? featureName : generateSessionName(db));

    // Handle worktree creation if requested
    let worktreePath: string | null = null;
    let branchName: string | null = null;
    let actualWorkingDirectory = workingDirectory;
    let port: number | null = null;
    let setupResult: SetupResult | null = null;

    if (useWorktree && featureName) {
      const providerDef = getProviderDefinition(agentType);
      if (providerDef.worktreeFlag) {
        // Native worktree: CLI manages the worktree itself via --worktree flag.
        // Just record the branch name; working directory stays as project root.
        branchName = generateBranchName(featureName);
      } else {
        // Custom worktree: agent-os creates and manages the worktree directory.
        try {
          const worktreeInfo = await createWorktree({
            projectPath: workingDirectory,
            featureName,
            baseBranch,
          });
          worktreePath = worktreeInfo.worktreePath;
          branchName = worktreeInfo.branchName;
          actualWorkingDirectory = worktreeInfo.worktreePath;

          // Find an available port for the dev server
          port = await findAvailablePort();

          // Run environment setup in background (non-blocking)
          const capturedWorktreePath = worktreeInfo.worktreePath;
          const capturedSourcePath = workingDirectory;
          const capturedPort = port;
          runInBackground(async () => {
            const result = await setupWorktree({
              worktreePath: capturedWorktreePath,
              sourcePath: capturedSourcePath,
              port: capturedPort,
              projectId,
            });
            console.log("Worktree setup completed:", {
              port: capturedPort,
              envFilesCopied: result.envFilesCopied,
              stepsRun: result.steps.length,
              success: result.success,
            });
          }, `setup-worktree-${id}`);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown error";
          return NextResponse.json(
            { error: `Failed to create worktree: ${message}` },
            { status: 400 }
          );
        }
      }
    }

    // Handle simple branch creation (no worktree)
    if (!useWorktree && createBranch && featureName) {
      try {
        const { expandPath, checkoutBranch, createBranch: gitCreateBranch } = await import("@/lib/git-status");
        const expandedDir = expandPath(workingDirectory);
        // Switch to base branch, then create new branch
        checkoutBranch(expandedDir, baseBranch);
        gitCreateBranch(expandedDir, featureName);
        branchName = featureName;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json(
          { error: `Failed to create branch: ${message}` },
          { status: 400 }
        );
      }
    }

    const tmuxName = useTmux ? `${agentType}-${id}` : null;
    queries.createSession(db).run(
      id,
      name,
      tmuxName,
      actualWorkingDirectory,
      parentSessionId,
      model,
      systemPrompt,
      groupPath,
      agentType,
      autoApprove ? 1 : 0, // SQLite stores booleans as integers
      continueSession ? 1 : 0,
      projectId
    );

    if (startedBy) {
      db.prepare("UPDATE sessions SET started_by = ? WHERE id = ?").run(
        JSON.stringify(startedBy),
        id
      );
    }

    if (agentType === "claude" && (pickedModel || subagentModel)) {
      db.prepare(
        "UPDATE sessions SET model_pinned = ?, subagent_model = ?, subagent_own_first = ? WHERE id = ?"
      ).run(
        pickedModel ? 1 : null,
        subagentModel,
        subagentModel && claudeModels.ownFirst ? 1 : null,
        id
      );
    }

    if (permissionMode) {
      queries
        .updateSessionPermissionMode(db)
        .run(permissionMode, null, autoApprove ? 1 : 0, id);
    }

    // Set worktree info if created
    if (worktreePath) {
      queries
        .updateSessionWorktree(db)
        .run(worktreePath, branchName, baseBranch, port, id);
    } else if (branchName) {
      // Simple branch creation (no worktree) — store branch info
      db.prepare("UPDATE sessions SET branch_name = ?, base_branch = ? WHERE id = ?")
        .run(branchName, baseBranch, id);
    }

    // Set claude_session_id if provided (for importing external sessions)
    if (claudeSessionId) {
      db.prepare("UPDATE sessions SET claude_session_id = ? WHERE id = ?").run(
        claudeSessionId,
        id
      );
    }

    // If forking, copy messages from parent
    if (parentSessionId) {
      const parentMessages = queries
        .getSessionMessages(db)
        .all(parentSessionId);
      for (const msg of parentMessages as Array<{
        role: string;
        content: string;
        duration_ms: number | null;
      }>) {
        queries
          .createMessage(db)
          .run(id, msg.role, msg.content, msg.duration_ms);
      }
    }

    const session = queries.getSession(db).get(id) as Session;
    if (autoApprove) announceFullAccess(session);

    // Get project's initial prompt if available
    const project = projectId ? getProject(projectId) : null;
    const projectInitialPrompt = project?.initial_prompt?.trim();
    const sessionInitialPrompt = initialPrompt?.trim();

    // Combine prompts: project prompt first, then session prompt
    let combinedPrompt: string | undefined;
    if (projectInitialPrompt && sessionInitialPrompt) {
      combinedPrompt = `${projectInitialPrompt}\n\n${sessionInitialPrompt}`;
    } else if (projectInitialPrompt) {
      combinedPrompt = projectInitialPrompt;
    } else if (sessionInitialPrompt) {
      combinedPrompt = sessionInitialPrompt;
    }

    // Include setup result and initial prompt in response
    const response: {
      session: Session;
      setup?: SetupResult;
      initialPrompt?: string;
    } = { session };
    if (setupResult) {
      response.setup = setupResult;
    }
    if (launch && useTmux) {
      try {
        await launchSession(session, combinedPrompt);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json(
          { session, error: `Created but failed to start: ${message}` },
          { status: 500 }
        );
      }
    } else if (combinedPrompt) {
      // The page sends it when it starts the session
      response.initialPrompt = combinedPrompt;
    }

    // Native --worktree: the CLI makes the folder once it starts; set it up then
    if (useWorktree && branchName && !worktreePath && getProviderDefinition(agentType).worktreeFlag) {
      const repoPath = workingDirectory;
      const name = branchName;
      runInBackground(async () => {
        await setupNativeWorktreeWhenReady({ repoPath, name, projectId });
      }, `setup-native-worktree-${id}`);
    }

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    console.error("Error creating session:", error);
    return NextResponse.json(
      { error: "Failed to create session" },
      { status: 500 }
    );
  }
}
