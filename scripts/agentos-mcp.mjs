#!/usr/bin/env node
/**
 * AgentOS as tools, for Claude Code, Codex, Gemini or any MCP client:
 * projects, sessions, starting work, talking to sessions and reading them.
 *
 *   claude mcp add -s user agent-os -- agent-os mcp
 *
 * Talks to the running server over loopback (AGENTOS_URL, default
 * http://localhost:3011), which needs no sign-in from inside the machine.
 *
 * Permission decisions stay with the user: every request is marked as an
 * agent's (x-agentos-origin: agent, plus x-agentos-actor: its own tmux
 * session), and the server refuses an agent's answer to a permission
 * request, its auto-approve and any change to a permission mode.
 *
 * Linked machines (another AgentOS, e.g. a Mac, linked to this one): the
 * session tools take `machine`, and the call goes there through this
 * server (/m/<id>/...). This server refuses unless the user has let its
 * sessions use that machine (Settings, Machines).
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE = process.env.AGENTOS_URL || "http://localhost:3011";

const PERMISSION_USER_ONLY =
  "Permission requests can only be answered by the user in AgentOS. Ask the user.";

const NOT_HERE =
  "On another machine, name a project there; only Claude sessions can be started.";

/**
 * Where a tool call goes ({ id, name, prefix, viaHub }); unset: this one.
 * On a server, a linked machine is /m/<id>. On a linked machine, the
 * server is /api/hub and another machine /api/hub/m/<id>: the server
 * decides what a session here may do there (viaHub)
 */
const where = new AsyncLocalStorage();

/** This server's own answer, whatever machine the tool call is for */
const here = (fn) => where.run(undefined, fn);

let hubCache = null;

/**
 * This AgentOS's link to its server, when it is a linked machine (GET
 * /api/hub, kept 15 s); null on a server, or an older one without it
 */
async function hubInfo() {
  if (hubCache && Date.now() - hubCache.at < 15000) return hubCache.value;
  let value = null;
  try {
    const res = await fetch(`${BASE}/api/hub`, {
      headers: { "X-AgentOS-Origin": "agent" },
    });
    const data = res.ok ? await res.json() : null;
    // A server answers { linked: false } and nothing more
    if (data && typeof data === "object" && "supported" in data) value = data;
  } catch {
    // Not up yet: asked again on the next call
  }
  hubCache = { at: Date.now(), value };
  return value;
}

const hubName = (info) => info?.hubName || "the server";
const myName = (info) => info?.name || "this machine";

/** The error a tool shows, in words the session can pass to the user */
async function errorText(data, res, path, target) {
  const code = data.code;
  if (code === "hub_agents_off") {
    const info = await hubInfo();
    return `The user hasn't let sessions on ${myName(info)} use ${hubName(info)}. They can allow it in AgentOS: Settings, Machines.`;
  }
  if (code === "moved" && data.name) {
    return `It continues on ${data.name}: pass machine "${data.name}".`;
  }
  if (code === "hub_unreachable")
    return "The server couldn't answer. Try again.";
  if (target && code === "machine_agents_off") {
    const through = target.viaHub ? hubName(await hubInfo()) : "this server";
    return `The user hasn't let sessions on ${through} use ${target.name}. They can turn it on in AgentOS: Settings, Machines.`;
  }
  if (
    target &&
    (code === "machine_offline" ||
      code === "machine_unreachable" ||
      (code === "machine_unknown" && !target.viaHub))
  ) {
    return `${target.name} can't be reached right now (${data.error}).`;
  }
  return data.error || `${res.status} ${res.statusText} on ${path}`;
}

async function api(path, options = {}) {
  // Changing a session's permission mode is the user's, not a tool
  if (/\/permission-mode(\/|\?|$)/.test(path)) {
    throw new Error(PERMISSION_USER_ONLY);
  }
  const target = where.getStore();
  const res = await fetch(`${BASE}${target?.prefix ?? ""}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
      "X-AgentOS-Origin": "agent",
      // Who is asking, for the user's record of what agents tried
      ...(ownTmux ? { "X-AgentOS-Actor": ownTmux } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) throw new Error(await errorText(data, res, path, target));
  return data;
}

/**
 * Where tool calls can go. On a server: the linked machines. On a linked
 * machine: its server first, then the server's other machines
 */
async function machines() {
  const info = await hubInfo();
  if (!info) {
    const data = await here(() => api("/api/machines"));
    return (data.machines ?? [])
      .filter((m) => m.status === "approved")
      .map((m) => ({
        id: m.id,
        name: m.name,
        kind: "machine",
        platform: m.platform,
        online: m.presence === "online",
        usable: !!m.agents,
        note: m.agents
          ? undefined
          : "The user hasn't allowed sessions here to use it (Settings, Machines)",
        target: { id: m.id, name: m.name, prefix: `/m/${m.id}`, viaHub: false },
      }));
  }
  const hub = hubName(info);
  const server = {
    id: "hub",
    name: info.hubName || "Server",
    kind: "server",
    online: info.linked,
    usable: info.linked && info.supported && info.agents,
    note: !info.linked
      ? "This machine isn't connected to its server right now."
      : !info.supported
        ? "The server's AgentOS needs to update before sessions here can use it."
        : !info.agents
          ? `The user hasn't let sessions on ${myName(info)} use it (Settings, Machines)`
          : undefined,
    target: {
      id: "hub",
      name: info.hubName || "the server",
      prefix: "/api/hub",
      viaHub: true,
    },
  };
  let peers = [];
  if (server.usable) {
    try {
      const data = await where.run(server.target, () => api("/api/link/peers"));
      peers = (data.machines ?? []).filter((m) => m.id !== info.machineId);
    } catch {
      // Only the server, then
    }
  }
  return [
    server,
    ...peers.map((m) => ({
      id: m.id,
      name: m.name,
      kind: "machine",
      platform: m.platform,
      online: !!m.online,
      usable: !!m.usableByServerSessions,
      note: m.usableByServerSessions
        ? `Reached through ${hub}`
        : `The user hasn't let sessions on ${hub} use it (Settings, Machines)`,
      target: {
        id: m.id,
        name: m.name,
        prefix: `/api/hub/m/${m.id}`,
        viaHub: true,
      },
    })),
  ];
}

/**
 * Where `ref` (an id or a name) is; null for this machine itself. On a
 * linked machine "hub", "server" and the server's name mean the server
 */
async function findMachine(ref) {
  const info = await hubInfo();
  const key = ref.trim().toLowerCase();
  if (info) {
    if (
      key === (info.name || "").toLowerCase() ||
      ref === info.machineId ||
      key === "this machine"
    ) {
      return null;
    }
  }
  const list = await machines();
  if (info && ["hub", "server", "the server"].includes(key)) {
    return check(list[0]);
  }
  const found =
    list.find((m) => m.id === ref) ||
    list.find((m) => m.name.toLowerCase() === key) ||
    list.filter((m) => m.name.toLowerCase().includes(key));
  const one = Array.isArray(found)
    ? found.length === 1
      ? found[0]
      : null
    : found;
  if (!one) {
    throw new Error(
      list.length
        ? `No one linked machine matches "${ref}". Linked: ${list.map((m) => m.name).join(", ")}`
        : "No machine is linked to this AgentOS."
    );
  }
  return check(one);
}

function check(machine) {
  if (!machine.online) {
    throw new Error(
      machine.kind === "server" && machine.note
        ? machine.note
        : `${machine.name} is offline.`
    );
  }
  return machine.target;
}

const ROLE = await hubInfo();

const MACHINE = z
  .string()
  .optional()
  .describe(
    ROLE
      ? "A linked machine, or the server (name or id from list_machines), to do this on instead of here"
      : "A linked machine (name or id from list_machines) to do this on, instead of this server"
  );

/** A tool that takes `machine`: its calls go to that machine */
const onMachine = (fn) => async (args) => {
  if (!args.machine) return fn(args);
  const target = await findMachine(args.machine);
  return target ? where.run(target, () => fn(args)) : fn(args);
};

/** ~ is the machine's home there, not this server's */
const homePath = (dir) =>
  where.getStore() ? dir : dir.replace(/^~(?=$|\/)/, os.homedir());

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

/** What the user calls the machine this session runs on */
async function ownName() {
  const info = await hubInfo();
  if (info) return myName(info);
  try {
    const data = await here(() => api("/api/machines"));
    return data.serverName || "the server";
  } catch {
    return "the server";
  }
}

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
  // Another machine's sessions are never this one
  if (where.getStore()) return;
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
    // Before its first turn (folder trust) or mid-turn: the screen knows,
    // and it isn't a question (that would be an ask), so it's the user's
    return {
      state: "waiting for permission",
      user_only: true,
      context,
      question: prompt.question || prompt.title || undefined,
      options: prompt.options.map((o) => ({ index: o.index, label: o.label })),
    };
  }
  if (!context) return { state: "starting" };
  return {
    state: KINDS[context.kind] ?? context.kind,
    user_only: context.kind === "permission" || undefined,
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
      "AgentOS runs the coding sessions on this machine (Claude Code, Codex, Gemini), each in its own tmux terminal, and the user watches and answers them from the AgentOS app on their phone.",
      "Use these tools when the user asks you to start, hand work to, check on, answer or stop another session, or to work across projects in parallel.",
      "A typical run: list_projects (or create_project), start_session with a task, then wait_for_session and read_session; when it is asking a question, answer_prompt.",
      "Permission requests are the user's: you can't answer them (answer_prompt and send_message refuse) or start sessions that skip them. When a session is waiting for permission, tell the user and let them answer it in AgentOS.",
      "You can't control your own session. Don't stop, interrupt or answer prompts in sessions you didn't start unless the user asks.",
      "The user is on their phone, not this machine: a server you start (a dev server, a preview, a test page) is reachable only through AgentOS's port proxy. When you start one, give the user its preview_url link, never a localhost or 0.0.0.0 address, and don't open ports to the network. Bind to 127.0.0.1 or 0.0.0.0 on any free port. list_servers shows what runs; stop_server stops only servers your own session started.",
      "Linked machines (list_machines), e.g. the user's Mac: pass `machine` to the project and session tools to work there, for what only that machine can do (Xcode, the iOS simulator, macOS-only tools). A session there is its own agent on that machine with its own files: give it a complete task, and move code between machines with git. It only works when the user has allowed it for that machine in Settings, Machines; if it's refused, tell the user.",
      "When the user approves, rejects or drops a mock you published, record it with set_mock_status (with the PR once it's built).",
      "A job (run_job) hands one piece of work to a linked machine while your chat stays here: the machine gets your code as it is, runs it, and the result comes back. Prefer it to start_session with `machine` when you want something done with your current code (a build, tests, the simulator) rather than a separate line of work.",
      ...(ROLE
        ? [
            `This machine is linked to the user's server (${hubName(ROLE)}). list_machines shows it and the user's other machines: pass machine to work there. It only works when the user has allowed it in Settings, Machines; if it's refused, tell the user. Sessions you start elsewhere are announced to the user and always ask before acting.`,
          ]
        : []),
    ].join("\n"),
  }
);

server.registerTool(
  "list_machines",
  {
    description:
      "List the machines linked to this AgentOS (e.g. the user's Mac): name, id, platform, whether each is online and whether the user lets sessions here use it. Pass a machine's name as `machine` to the project and session tools to work there.",
    inputSchema: {},
  },
  tool(async () => {
    const list = await machines();
    if (!(await hubInfo())) {
      return list.map((m) => ({
        id: m.id,
        name: m.name,
        platform: m.platform,
        online: m.online,
        usable_by_sessions: m.usable,
        note: m.note,
      }));
    }
    return list.map((m) => ({
      id: m.id,
      name: m.name,
      kind: m.kind,
      ...(m.platform ? { platform: m.platform } : {}),
      online: m.online,
      usable_by_sessions: m.usable,
      note: m.note,
    }));
  })
);

server.registerTool(
  "list_projects",
  {
    description:
      "List AgentOS projects: name, id, directory, default agent and model.",
    inputSchema: { machine: MACHINE },
  },
  tool(
    onMachine(async () =>
      (await projects()).map((p) => ({
        id: p.id,
        name: p.name,
        directory: p.working_directory,
        agent: p.agent_type,
        model: p.default_model,
      }))
    )
  )
);

server.registerTool(
  "create_project",
  {
    description:
      "Create an AgentOS project for a directory. Sessions started in it get the project's context and other sessions' summaries.",
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
      machine: MACHINE,
    },
  },
  tool(
    onMachine(async ({ name, directory, create_directory, agent, model }) => {
      if (where.getStore()?.viaHub) {
        throw new Error(
          "create_project only works on this machine. Ask the user to add the project there."
        );
      }
      const path = homePath(directory);
      if (create_directory) {
        if (where.getStore())
          throw new Error(
            "create_directory only works on this server. On a linked machine, have a session there create it."
          );
        fs.mkdirSync(path, { recursive: true });
      }
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
  )
);

server.registerTool(
  "list_sessions",
  {
    description:
      "List AgentOS sessions with what each is doing: working, asking a question, waiting for permission, done, or stopped.",
    inputSchema: {
      project: z.string().optional().describe("Only this project (name or id)"),
      running_only: z
        .boolean()
        .optional()
        .describe("Only sessions that are running"),
      machine: MACHINE,
    },
  },
  tool(
    onMachine(async ({ project, running_only }) => {
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
            this_session:
              (!where.getStore() && ownTmux === tmuxOf(s)) || undefined,
          };
        })
      );
    })
  )
);

server.registerTool(
  "start_session",
  {
    description:
      "Start a new AgentOS session (it appears in the AgentOS app) and give it a task. Runs without anyone watching; check on it with read_session or wait_for_session. It always asks for permission as usual; only the user can approve its requests or turn on auto-approve, in AgentOS.",
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
      machine: MACHINE,
    },
  },
  tool(
    onMachine(
      async ({ task, project, directory, name, agent, model, branch }) => {
        const target = where.getStore();
        if (target?.viaHub) {
          // Another machine starts only Claude sessions, in its projects
          if (!project || directory || (agent && agent !== "claude")) {
            throw new Error(NOT_HERE);
          }
          const p = findProject(await projects(), project);
          const { session, error } = await api("/api/sessions", {
            method: "POST",
            body: {
              projectId: p.id,
              name,
              initialPrompt: task || null,
              model: model || undefined,
              useWorktree: !!branch,
              featureName: branch || null,
            },
          });
          if (error) throw new Error(error);
          return {
            id: session.id,
            name: session.name,
            directory: session.worktree_path || session.working_directory,
            branch: session.branch_name || undefined,
            machine: target.name,
            started: true,
            note: "It asks the user before it acts.",
          };
        }
        const p = project ? findProject(await projects(), project) : null;
        const cwd = homePath(directory || p?.working_directory || "~");
        const { session, error } = await api("/api/sessions", {
          method: "POST",
          body: {
            name,
            workingDirectory: cwd,
            projectId: p?.id ?? "uncategorized",
            agentType: agent || p?.agent_type || "claude",
            model: model || p?.default_model || undefined,
            autoApprove: false,
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
          machine: where.getStore()?.name,
          started: true,
        };
      }
    )
  )
);

server.registerTool(
  "send_message",
  {
    description:
      "Type a message into a running session and press Enter, as if you sent it from AgentOS. Refused while the session is waiting for permission (only the user can answer that), and for a session with full access unless yours has it too.",
    inputSchema: {
      session: z.string().describe("Session id, id prefix or name"),
      machine: MACHINE,
      text: z.string().describe("The message"),
    },
  },
  tool(
    onMachine(async ({ session, text }) => {
      const s = await findSession(session);
      notSelf(s, "message");
      const target = where.getStore();
      let message = text;
      let busyNow = false;
      if (target) {
        // Across machines: say where it came from, unless it answers a
        // prompt on screen. A shell would run that line: it gets the text alone
        const [{ prompt }, { state }] = await Promise.all([
          get(`/api/sessions/${s.id}/prompt`),
          running().then((live) => inspect(s, live)),
        ]);
        if (!prompt && s.agent_type !== "shell") {
          message = `[Message from a session on ${await ownName()}, sent with AgentOS. No reply is needed unless it asks for one.]\n${text}`;
        }
        busyNow = busy(state);
      }
      await api(`/api/sessions/${s.id}/send-keys`, {
        method: "POST",
        body: { text: message, pressEnter: true },
      });
      return busyNow
        ? `Sent to ${s.name}; it is busy and will read it after this reply`
        : `Sent to ${s.name}`;
    })
  )
);

server.registerTool(
  "read_session",
  {
    description:
      "What a session is doing: its state, Claude's last message (or the question it's asking, with options), and the end of its terminal.",
    inputSchema: {
      session: z.string().describe("Session id, id prefix or name"),
      machine: MACHINE,
      terminal_lines: z
        .number()
        .int()
        .min(0)
        .max(50)
        .optional()
        .describe("Lines of terminal to include (default 20, max 50)"),
    },
  },
  tool(
    onMachine(async ({ session, terminal_lines = 20 }) => {
      const s = await findSession(session);
      const live = await running();
      const { state, user_only, context, question, options } = await inspect(
        s,
        live
      );
      const preview =
        live.has(tmuxOf(s)) && terminal_lines > 0
          ? ((await get(`/api/sessions/${s.id}/preview`)).lines ?? [])
          : [];
      return {
        name: s.name,
        state,
        note: user_only ? PERMISSION_USER_ONLY : undefined,
        question,
        options,
        last_message: context?.text ?? undefined,
        terminal: preview.slice(-terminal_lines).join("\n") || undefined,
      };
    })
  )
);

server.registerTool(
  "wait_for_session",
  {
    description:
      "Wait until a session stops working (finished, asking a question or waiting for permission), then return what read_session would. A permission request is for the user to answer, not you.",
    inputSchema: {
      session: z.string().describe("Session id, id prefix or name"),
      machine: MACHINE,
      timeout_seconds: z
        .number()
        .int()
        .min(5)
        .max(1800)
        .optional()
        .describe("Give up after this long (default 300)"),
    },
  },
  tool(
    onMachine(async ({ session, timeout_seconds = 300 }) => {
      const s = await findSession(session);
      notSelf(s, "wait for");
      const end = Date.now() + timeout_seconds * 1000;
      // A turn just sent may not show as working for a moment
      await new Promise((r) => setTimeout(r, 4000));
      for (;;) {
        const { state, user_only, context, question, options } = await inspect(
          s,
          await running()
        );
        if (!busy(state) || Date.now() > end) {
          return {
            name: s.name,
            state,
            timed_out: busy(state) || undefined,
            note: user_only ? PERMISSION_USER_ONLY : undefined,
            question,
            options,
            last_message: context?.text ?? undefined,
          };
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
    })
  )
);

server.registerTool(
  "answer_prompt",
  {
    description:
      "Answer a question a session's Claude is asking (AskUserQuestion) by picking an option, by its index and label from read_session. Permission requests can't be answered here: only the user can, in AgentOS.",
    inputSchema: {
      session: z.string().describe("Session id, id prefix or name"),
      machine: MACHINE,
      index: z
        .number()
        .int()
        .describe("The option's index, as read_session showed it"),
      label: z
        .string()
        .describe("The option's label, so a changed prompt isn't answered"),
    },
  },
  tool(
    onMachine(async ({ session, index, label }) => {
      const s = await findSession(session);
      notSelf(s, "answer");
      // Only a question: anything else, or unclear, is a permission request
      const { user_only, context } = await inspect(s, await running());
      if (user_only || context?.kind !== "ask")
        throw new Error(PERMISSION_USER_ONLY);
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
  )
);

server.registerTool(
  "interrupt_session",
  {
    description: "Press Esc in a session, stopping its agent mid-turn.",
    inputSchema: {
      session: z.string().describe("Session id, id prefix or name"),
      machine: MACHINE,
    },
  },
  tool(
    onMachine(async ({ session }) => {
      const s = await findSession(session);
      notSelf(s, "interrupt");
      await api(`/api/sessions/${s.id}/interrupt`, { method: "POST" });
      return `Interrupted ${s.name}`;
    })
  )
);

server.registerTool(
  "stop_session",
  {
    description:
      "End a session's agent and terminal. The session stays in AgentOS; opening it starts it again.",
    inputSchema: {
      session: z.string().describe("Session id, id prefix or name"),
      machine: MACHINE,
    },
  },
  tool(
    onMachine(async ({ session }) => {
      const s = await findSession(session);
      notSelf(s, "stop");
      const { stopped } = await api(`/api/sessions/${s.id}/stop`, {
        method: "POST",
      });
      return stopped ? `Stopped ${s.name}` : `${s.name} wasn't running`;
    })
  )
);

async function servers() {
  return (await api("/api/running")).servers;
}

const serverRow = (s) => ({
  port: s.port,
  link: s.link,
  command: s.command || s.name,
  folder: s.cwd,
  started_by: s.sessionName,
  yours: !!ownTmux && s.tmux === ownTmux,
  started_at: s.startedAt ? new Date(s.startedAt).toISOString() : null,
});

server.registerTool(
  "list_servers",
  {
    description:
      "List the servers listening in this machine that the user can reach through AgentOS: port, the link to give the user, command, folder, and the session that started it.",
    inputSchema: {},
  },
  tool(async () => (await servers()).map(serverRow))
);

server.registerTool(
  "preview_url",
  {
    description:
      "The link the user opens to reach a server on this machine (through AgentOS's port proxy). Give the user this, never localhost.",
    inputSchema: {
      port: z.number().int().min(1).max(65535).describe("The server's port"),
      path: z
        .string()
        .optional()
        .describe("A path on the server, e.g. /settings (default /)"),
    },
  },
  tool(async ({ port, path }) => {
    const found = (await servers()).find((s) => s.port === port);
    if (!found)
      throw new Error(
        `Nothing the user can reach listens on port ${port}. Start the server first (or it is AgentOS itself, or a port the proxy refuses).`
      );
    const rest = (path || "/").replace(/^\/*/, "");
    return found.link + rest;
  })
);

server.registerTool(
  "stop_server",
  {
    description:
      "Stop a server your own session started (SIGTERM). Servers other sessions or the user started are theirs: ask the user.",
    inputSchema: {
      port: z.number().int().min(1).max(65535).describe("The server's port"),
    },
  },
  tool(async ({ port }) => {
    const found = (await servers()).find((s) => s.port === port);
    if (!found?.pid) throw new Error(`Nothing listens on port ${port}`);
    await api(`/api/running/${found.pid}`, { method: "DELETE" });
    return `Stopped :${port}`;
  })
);

server.registerTool(
  "set_mock_status",
  {
    description:
      "Record where a mock you published (a claude.ai artifact link) stands on the user's Mocks page: completed when the user approved it and it was built (give the PR), rejected when the user turned it down, abandoned when the user dropped it, ongoing when work on it resumes. Only mocks published since AgentOS began tracking them.",
    inputSchema: {
      url: z.string().describe("The mock's claude.ai artifact link"),
      status: z.enum(["ongoing", "completed", "rejected", "abandoned"]),
      pr: z
        .string()
        .optional()
        .describe("The PR that built it, e.g. #162 or a link"),
      note: z
        .string()
        .optional()
        .describe("A few words on why, e.g. 'User picked option B'"),
    },
  },
  tool(async ({ url, status, pr, note }) => {
    await api("/api/mocks", {
      method: "PATCH",
      body: { url, status, note, ...(pr ? { pr } : {}) },
    });
    return `Marked ${status}`;
  })
);

/** A job as the chat that sent it needs it */
function jobOut(job) {
  const out = {
    job: job.id,
    title: job.title,
    machine: job.machineName,
    state: job.state,
  };
  if (job.state === "queued") {
    out.note =
      job.step ||
      (job.ahead > 0
        ? `Waiting its turn: ${job.ahead} ahead of it on ${job.machineName}.`
        : "Waiting its turn.");
  }
  if (job.state === "sending")
    out.note = job.step || "Its code is being copied.";
  if (job.state === "waiting") {
    out.question = job.question || "It asks the user something.";
    out.note = `It waits for the user, who answers it in AgentOS (the job's card in this chat opens it on ${job.machineName}). You can't answer for them. Tell the user, then wait_for_job again.`;
  }
  if (job.code) {
    out.code_sent =
      job.code.unsaved > 0
        ? `This chat's code at ${job.code.head.slice(0, 7)} with ${job.code.unsaved} unsaved file(s)`
        : `This chat's code at ${job.code.head.slice(0, 7)}`;
    if (job.code.skipped > 0) {
      out.left_behind = `${job.code.skipped} file(s) were not sent (too large, or a nested repository).`;
    }
  }
  if (job.state === "done") {
    out.result = job.result || "It finished without a message.";
    const files = job.changed?.files ?? [];
    if (files.length > 0) {
      out.changed_files = files.map((f) => f.path);
      out.changes = job.patch
        ? `Its changes are NOT in your folder yet. To take them, from your repository's top folder: git apply --3way ${job.patch}`
        : job.changed.tooBig
          ? "Its changes were too large to bring back; they are lost with its folder unless the job is run again and told to push them."
          : "Its changes could not be brought back.";
    } else {
      out.changes = "It changed no files.";
    }
  }
  if (job.state === "failed") out.error = job.error || "It failed.";
  if (job.state === "stopped") out.note = "It was stopped.";
  return out;
}

/** Waits in short asks, so no single call outlasts a proxy or fetch timeout */
async function waitJob(id, seconds) {
  const end = Date.now() + seconds * 1000;
  for (;;) {
    const left = Math.ceil((end - Date.now()) / 1000);
    const { job } = await api(
      `/api/jobs/${encodeURIComponent(id)}${left > 0 ? `?wait=${Math.min(25, left)}` : ""}`
    );
    const over = ["done", "failed", "stopped", "waiting"].includes(job.state);
    if (over || left <= 0) return job;
  }
}

server.registerTool(
  "run_job",
  {
    description:
      "Hand one piece of work to a linked machine while this chat stays here: a build, a test run, the iOS simulator, anything this machine can't do and that one can (\"The machine you run on\" in your notes says what each has). The machine gets this chat's code as it is now, unsaved files included, in a throwaway folder, runs the task as a session of its own, and sends back its last message plus a patch of any files it changed. Use it when the user names a machine with @, or when the work needs something only that machine has. Write the task so it stands alone: what to run, what counts as success, what to report. One job per machine runs at a time; others wait. How much the job's session may do without asking is the user's setting for that machine: by default it asks them before every command (they answer in AgentOS, so a job can sit at \"needs the user\"); if they chose otherwise it runs by itself. This project's own Claude files (.claude, .mcp.json: settings, hooks, skills, MCP servers) are not loaded there, only what is set up on that machine. Returns once the job is over or needs the user, or after wait_seconds (then call wait_for_job).",
    inputSchema: {
      machine: z
        .string()
        .describe("The machine to run it on: its name (e.g. Mac Studio) or id"),
      title: z
        .string()
        .describe(
          "A few words the user sees, e.g. 'Widget tests on the simulator'"
        ),
      task: z
        .string()
        .describe(
          "The whole task for the session that runs it. It sees the code but not this conversation"
        ),
      wait_seconds: z
        .number()
        .int()
        .min(0)
        .max(1800)
        .optional()
        .describe("How long to wait for it here (default 600, max 1800)"),
    },
  },
  tool(async ({ machine, title, task, wait_seconds = 600 }) => {
    const { job } = await api("/api/jobs", {
      method: "POST",
      body: { machine, title, task },
    });
    return jobOut(wait_seconds > 0 ? await waitJob(job.id, wait_seconds) : job);
  })
);

server.registerTool(
  "wait_for_job",
  {
    description:
      "Wait until a job you sent with run_job is over or needs the user, then return its state, result and changed files. Also the way to check on one without waiting (timeout_seconds 0).",
    inputSchema: {
      job: z.string().describe("The job id run_job returned"),
      timeout_seconds: z
        .number()
        .int()
        .min(0)
        .max(1800)
        .optional()
        .describe("How long to wait (default 600, max 1800)"),
    },
  },
  tool(async ({ job, timeout_seconds = 600 }) => {
    return jobOut(await waitJob(job, timeout_seconds));
  })
);

server.registerTool(
  "list_jobs",
  {
    description:
      "The jobs this chat sent to other machines with run_job, newest first, and which machines can take one now.",
    inputSchema: {},
  },
  tool(async () => {
    const view = await api("/api/jobs?limit=20");
    return {
      machines: view.machines.map((m) => ({
        name: m.name,
        id: m.id,
        can_take_a_job: !m.blocked,
        ...(m.blocked ? { why_not: m.blocked } : {}),
      })),
      jobs: view.jobs.map(jobOut),
    };
  })
);

server.registerTool(
  "stop_job",
  {
    description:
      "Stop a job you sent with run_job. Its session and folder on the machine are removed; nothing comes back.",
    inputSchema: { job: z.string().describe("The job id") },
  },
  tool(async ({ job }) => {
    const out = await api(`/api/jobs/${encodeURIComponent(job)}`, {
      method: "DELETE",
    });
    return jobOut(out.job);
  })
);

await server.connect(new StdioServerTransport());
