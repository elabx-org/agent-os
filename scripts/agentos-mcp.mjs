#!/usr/bin/env node
/**
 * Agent-OS as tools, for Claude Code, Codex, Gemini or any MCP client:
 * projects, sessions, starting work, talking to sessions and reading them.
 *
 *   claude mcp add -s user agent-os -- agent-os mcp
 *
 * Talks to the running server over loopback (AGENTOS_URL, default
 * http://localhost:3011), which needs no sign-in from inside the machine.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE = process.env.AGENTOS_URL || "http://localhost:3011";

async function api(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(data.error || `${res.status} ${res.statusText} on ${path}`);
  }
  return data;
}

/** The tmux session this server's own agent runs in, if any */
const ownTmux = (() => {
  if (!process.env.TMUX) return null;
  try {
    return execFileSync("tmux", ["display-message", "-p", "#S"], {
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
})();

const tmuxOf = (s) => s.tmux_name || `${s.agent_type || "claude"}-${s.id}`;

async function running() {
  const { sessions } = await api("/api/tmux-sessions");
  return new Set(sessions.map((s) => s.name));
}

async function projects() {
  const data = await api("/api/projects");
  return data.projects ?? data;
}

function findProject(list, ref) {
  const key = ref.trim().toLowerCase();
  const found =
    list.find((p) => p.id === ref) ||
    list.find((p) => p.name.toLowerCase() === key) ||
    list.filter((p) => p.name.toLowerCase().includes(key));
  if (Array.isArray(found)) {
    if (found.length === 1) return found[0];
    throw new Error(
      found.length
        ? `"${ref}" matches several projects: ${found.map((p) => p.name).join(", ")}`
        : `No project "${ref}". Projects: ${list.map((p) => p.name).join(", ")}`
    );
  }
  return found;
}

/** By id, id prefix or name ("Session 24" or a session's title) */
async function findSession(ref) {
  const { sessions } = await api("/api/sessions");
  const key = ref.trim().toLowerCase();
  const exact =
    sessions.find((s) => s.id === ref) ||
    sessions.find((s) => s.name.toLowerCase() === key);
  if (exact) return exact;
  const loose = sessions.filter(
    (s) => s.id.startsWith(ref) || s.name.toLowerCase().includes(key)
  );
  if (loose.length === 1) return loose[0];
  throw new Error(
    loose.length
      ? `"${ref}" matches several sessions: ${loose.map((s) => `${s.name} (${s.id.slice(0, 8)})`).join(", ")}`
      : `No session "${ref}"`
  );
}

function notSelf(session, verb) {
  if (ownTmux && tmuxOf(session) === ownTmux) {
    throw new Error(`That is this session; it can't ${verb} itself`);
  }
}

async function get(path) {
  try {
    return await api(path);
  } catch {
    return {};
  }
}

const KINDS = {
  working: "working",
  ask: "asking a question",
  permission: "waiting for permission",
  message: "done, waiting for you",
};

/**
 * What a session is doing, in a line a person or agent can act on, with
 * Claude's last turn and any selection prompt on screen (a trust or
 * permission dialog, a question) and its options
 */
async function inspect(session, live) {
  if (!live.has(tmuxOf(session))) return { state: "stopped" };
  if ((session.agent_type || "claude") !== "claude")
    return { state: "running" };
  const [{ context }, { prompt }] = await Promise.all([
    get(`/api/sessions/${session.id}/reply-context`),
    get(`/api/sessions/${session.id}/prompt`),
  ]);
  if (prompt && (!context || context.kind === "working")) {
    // Before its first turn (folder trust) or mid-turn: the screen knows
    return {
      state: "waiting at a prompt",
      context,
      question: prompt.question || prompt.title || undefined,
      options: prompt.options.map((o) => ({ index: o.index, label: o.label })),
    };
  }
  if (!context) return { state: "starting" };
  return {
    state: KINDS[context.kind] ?? context.kind,
    context,
    question: context.question ?? undefined,
    options: context.options?.length
      ? context.options.map((o) => ({ index: o.index, label: o.label }))
      : undefined,
  };
}

const busy = (state) => state === "working" || state === "starting";

const ok = (value) => ({
  content: [
    {
      type: "text",
      text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
    },
  ],
});
const fail = (error) => ({
  content: [{ type: "text", text: `Error: ${error.message ?? error}` }],
  isError: true,
});
const tool = (fn) => async (args) => {
  try {
    return ok(await fn(args));
  } catch (error) {
    return fail(error);
  }
};

const server = new McpServer(
  { name: "agent-os", version: "1.0.0" },
  {
    instructions: [
      "Agent-OS runs the coding sessions on this machine (Claude Code, Codex, Gemini), each in its own tmux terminal, and the user watches and answers them from the Agent-OS app on their phone.",
      "Use these tools when the user asks you to start, hand work to, check on, answer or stop another session, or to work across projects in parallel.",
      "A typical run: list_projects (or create_project), start_session with a task, then wait_for_session and read_session; when it is asking a question or waiting for permission, answer_prompt.",
      "You can't control your own session. Don't stop, interrupt or answer prompts in sessions you didn't start unless the user asks.",
    ].join("\n"),
  }
);

server.registerTool(
  "list_projects",
  {
    description:
      "List Agent-OS projects: name, id, directory, default agent and model.",
    inputSchema: {},
  },
  tool(async () =>
    (await projects()).map((p) => ({
      id: p.id,
      name: p.name,
      directory: p.working_directory,
      agent: p.agent_type,
      model: p.default_model,
    }))
  )
);

server.registerTool(
  "create_project",
  {
    description:
      "Create an Agent-OS project for a directory. Sessions started in it get the project's context and other sessions' summaries.",
    inputSchema: {
      name: z.string().describe("Project name"),
      directory: z.string().describe("Absolute path, or ~/..."),
      create_directory: z
        .boolean()
        .optional()
        .describe("Create the directory if it doesn't exist (default false)"),
      agent: z
        .enum(["claude", "codex", "opencode", "gemini", "shell"])
        .optional()
        .describe("Default agent for new sessions (default claude)"),
      model: z.string().optional().describe("Default model, e.g. opus, sonnet"),
    },
  },
  tool(async ({ name, directory, create_directory, agent, model }) => {
    const path = directory.replace(/^~(?=$|\/)/, os.homedir());
    if (create_directory) fs.mkdirSync(path, { recursive: true });
    const { project } = await api("/api/projects", {
      method: "POST",
      body: {
        name,
        workingDirectory: path,
        agentType: agent,
        defaultModel: model,
      },
    });
    return {
      id: project.id,
      name: project.name,
      directory: project.working_directory,
    };
  })
);

server.registerTool(
  "list_sessions",
  {
    description:
      "List Agent-OS sessions with what each is doing: working, asking a question, waiting for permission, done, or stopped.",
    inputSchema: {
      project: z.string().optional().describe("Only this project (name or id)"),
      running_only: z
        .boolean()
        .optional()
        .describe("Only sessions that are running"),
    },
  },
  tool(async ({ project, running_only }) => {
    const [{ sessions }, live, list] = await Promise.all([
      api("/api/sessions"),
      running(),
      projects(),
    ]);
    const only = project ? findProject(list, project) : null;
    const names = new Map(list.map((p) => [p.id, p.name]));
    const picked = sessions.filter(
      (s) =>
        (!only || s.project_id === only.id) &&
        (!running_only || live.has(tmuxOf(s)))
    );
    return Promise.all(
      picked.map(async (s) => {
        const { state } = await inspect(s, live);
        return {
          id: s.id,
          name: s.name,
          project: names.get(s.project_id) ?? s.project_id,
          agent: s.agent_type,
          directory: s.worktree_path || s.working_directory,
          branch: s.branch_name || undefined,
          state,
          this_session: ownTmux === tmuxOf(s) || undefined,
        };
      })
    );
  })
);

server.registerTool(
  "start_session",
  {
    description:
      "Start a new Agent-OS session (it appears in the Agent-OS app) and give it a task. Runs without anyone watching; check on it with read_session or wait_for_session.",
    inputSchema: {
      task: z
        .string()
        .optional()
        .describe("The first message to the agent; omit to start it idle"),
      project: z
        .string()
        .optional()
        .describe(
          "Project name or id; its directory is used unless directory is given"
        ),
      directory: z
        .string()
        .optional()
        .describe("Working directory (default: the project's)"),
      name: z
        .string()
        .optional()
        .describe("Session title (default: Session N)"),
      agent: z
        .enum(["claude", "codex", "opencode", "gemini", "shell"])
        .optional()
        .describe("Default: the project's agent, else claude"),
      model: z.string().optional().describe("e.g. opus, sonnet, haiku"),
      branch: z
        .string()
        .optional()
        .describe(
          "Work on a new branch in its own worktree, so it doesn't disturb the checkout"
        ),
      auto_approve: z
        .boolean()
        .optional()
        .describe("Skip permission prompts (default false)"),
    },
  },
  tool(
    async ({
      task,
      project,
      directory,
      name,
      agent,
      model,
      branch,
      auto_approve,
    }) => {
      const p = project ? findProject(await projects(), project) : null;
      const cwd = (directory || p?.working_directory || "~").replace(
        /^~(?=$|\/)/,
        os.homedir()
      );
      const { session, error } = await api("/api/sessions", {
        method: "POST",
        body: {
          name,
          workingDirectory: cwd,
          projectId: p?.id ?? "uncategorized",
          agentType: agent || p?.agent_type || "claude",
          model: model || p?.default_model || undefined,
          autoApprove: !!auto_approve,
          useWorktree: !!branch,
          featureName: branch || null,
          initialPrompt: task || null,
          launch: true,
        },
      });
      if (error) throw new Error(error);
      return {
        id: session.id,
        name: session.name,
        directory: session.worktree_path || session.working_directory,
        branch: session.branch_name || undefined,
        started: true,
      };
    }
  )
);

server.registerTool(
  "send_message",
  {
    description:
      "Type a message into a running session and press Enter, as if you sent it from Agent-OS.",
    inputSchema: {
      session: z.string().describe("Session id, id prefix or name"),
      text: z.string().describe("The message"),
    },
  },
  tool(async ({ session, text }) => {
    const s = await findSession(session);
    notSelf(s, "message");
    await api(`/api/sessions/${s.id}/send-keys`, {
      method: "POST",
      body: { text, pressEnter: true },
    });
    return `Sent to ${s.name}`;
  })
);

server.registerTool(
  "read_session",
  {
    description:
      "What a session is doing: its state, Claude's last message (or the question it's asking, with options), and the end of its terminal.",
    inputSchema: {
      session: z.string().describe("Session id, id prefix or name"),
      terminal_lines: z
        .number()
        .int()
        .min(0)
        .max(50)
        .optional()
        .describe("Lines of terminal to include (default 20, max 50)"),
    },
  },
  tool(async ({ session, terminal_lines = 20 }) => {
    const s = await findSession(session);
    const live = await running();
    const { state, context, question, options } = await inspect(s, live);
    const preview =
      live.has(tmuxOf(s)) && terminal_lines > 0
        ? ((await get(`/api/sessions/${s.id}/preview`)).lines ?? [])
        : [];
    return {
      name: s.name,
      state,
      question,
      options,
      last_message: context?.text ?? undefined,
      terminal: preview.slice(-terminal_lines).join("\n") || undefined,
    };
  })
);

server.registerTool(
  "wait_for_session",
  {
    description:
      "Wait until a session stops working (finished, asking a question or waiting for permission), then return what read_session would.",
    inputSchema: {
      session: z.string().describe("Session id, id prefix or name"),
      timeout_seconds: z
        .number()
        .int()
        .min(5)
        .max(1800)
        .optional()
        .describe("Give up after this long (default 300)"),
    },
  },
  tool(async ({ session, timeout_seconds = 300 }) => {
    const s = await findSession(session);
    notSelf(s, "wait for");
    const end = Date.now() + timeout_seconds * 1000;
    // A turn just sent may not show as working for a moment
    await new Promise((r) => setTimeout(r, 4000));
    for (;;) {
      const { state, context, question, options } = await inspect(
        s,
        await running()
      );
      if (!busy(state) || Date.now() > end) {
        return {
          name: s.name,
          state,
          timed_out: busy(state) || undefined,
          question,
          options,
          last_message: context?.text ?? undefined,
        };
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
  })
);

server.registerTool(
  "answer_prompt",
  {
    description:
      "Pick an option on the selection prompt a session's Claude is showing (a permission request or a question), by its index and label from read_session.",
    inputSchema: {
      session: z.string().describe("Session id, id prefix or name"),
      index: z
        .number()
        .int()
        .describe("The option's index, as read_session showed it"),
      label: z
        .string()
        .describe("The option's label, so a changed prompt isn't answered"),
    },
  },
  tool(async ({ session, index, label }) => {
    const s = await findSession(session);
    notSelf(s, "answer");
    const { prompt } = await api(`/api/sessions/${s.id}/prompt`);
    const option = prompt?.options.find((o) => o.label === label);
    if (!option)
      throw new Error("No such option on screen; read the session again");
    await api(`/api/sessions/${s.id}/prompt`, {
      method: "POST",
      body: { index: prompt.options.indexOf(option), label },
    });
    return `Answered "${label}" in ${s.name} (index ${index})`;
  })
);

server.registerTool(
  "interrupt_session",
  {
    description: "Press Esc in a session, stopping its agent mid-turn.",
    inputSchema: {
      session: z.string().describe("Session id, id prefix or name"),
    },
  },
  tool(async ({ session }) => {
    const s = await findSession(session);
    notSelf(s, "interrupt");
    await api(`/api/sessions/${s.id}/interrupt`, { method: "POST" });
    return `Interrupted ${s.name}`;
  })
);

server.registerTool(
  "stop_session",
  {
    description:
      "End a session's agent and terminal. The session stays in Agent-OS; opening it starts it again.",
    inputSchema: {
      session: z.string().describe("Session id, id prefix or name"),
    },
  },
  tool(async ({ session }) => {
    const s = await findSession(session);
    notSelf(s, "stop");
    const { stopped } = await api(`/api/sessions/${s.id}/stop`, {
      method: "POST",
    });
    return stopped ? `Stopped ${s.name}` : `${s.name} wasn't running`;
  })
);

await server.connect(new StdioServerTransport());
