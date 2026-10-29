import { test } from "node:test";
import assert from "node:assert/strict";
import {
  currentStep,
  planFromCalls,
  planFromEntries,
  planFromItems,
} from "../../lib/claude-plan";
import type { ChatItem } from "../../lib/claude-transcript";

const todos = (...list: [string, string][]) => ({
  todos: list.map(([content, status]) => ({ content, status, activeForm: "" })),
});

test("no plan calls: null", () => {
  assert.equal(planFromCalls([]), null);
  assert.equal(planFromItems([]), null);
});

test("the latest TodoWrite replaces the list", () => {
  const plan = planFromCalls([
    { name: "TodoWrite", input: todos(["Old", "pending"]) },
    {
      name: "TodoWrite",
      input: todos(
        ["Find it", "completed"],
        ["Fix it", "completed"],
        ["Check it", "completed"],
        ["Merge and deploy", "in_progress"],
        ["Tell you", "pending"]
      ),
    },
  ]);
  assert.deepEqual(plan, {
    done: 3,
    total: 5,
    items: [
      { text: "Find it", status: "done" },
      { text: "Fix it", status: "done" },
      { text: "Check it", status: "done" },
      { text: "Merge and deploy", status: "active" },
      { text: "Tell you", status: "todo" },
    ],
  });
  assert.equal(currentStep(plan!)?.text, "Merge and deploy");
});

test("an empty TodoWrite clears the plan", () => {
  assert.equal(
    planFromCalls([
      { name: "TodoWrite", input: todos(["A", "pending"]) },
      { name: "TodoWrite", input: { todos: [] } },
    ]),
    null
  );
});

test("tasks: created by id from the result, updated, deleted, in id order", () => {
  const plan = planFromCalls([
    {
      name: "TaskCreate",
      input: { subject: "Write plan", description: "", activeForm: "" },
      result: "Task #10 created successfully: Write plan",
    },
    {
      name: "TaskCreate",
      input: { subject: "Build it" },
      result: "Task #9 created successfully: Build it",
    },
    {
      name: "TaskCreate",
      input: { subject: "Dropped" },
      result: "Task #11 created successfully: Dropped",
    },
    // A create whose result isn't in yet is skipped
    { name: "TaskCreate", input: { subject: "Pending result" } },
    { name: "TaskUpdate", input: { taskId: "9", status: "completed" } },
    { name: "TaskUpdate", input: { taskId: "10", status: "in_progress" } },
    { name: "TaskUpdate", input: { taskId: "11", status: "deleted" } },
    // Unknown task: ignored
    { name: "TaskUpdate", input: { taskId: "99", status: "completed" } },
  ]);
  assert.deepEqual(plan, {
    done: 1,
    total: 2,
    items: [
      { text: "Build it", status: "done" },
      { text: "Write plan", status: "active" },
    ],
  });
});

test("whichever kind came last wins", () => {
  const calls = [
    {
      name: "TaskCreate",
      input: { subject: "Task" },
      result: "Task #1 created successfully: Task",
    },
    { name: "TodoWrite", input: todos(["Todo", "pending"]) },
  ];
  assert.equal(planFromCalls(calls)?.items[0].text, "Todo");
  assert.equal(planFromCalls([calls[1], calls[0]])?.items[0].text, "Task");
});

test("planFromItems reads tool items' input and results", () => {
  const items = [
    { kind: "user", id: "u1", text: "go", ts: "" },
    {
      kind: "tool",
      id: "t1",
      name: "TaskCreate",
      summary: "Ship",
      ts: "",
      input: { subject: "Ship" },
    },
    {
      kind: "result",
      id: "r1",
      toolUseId: "t1",
      isError: false,
      preview: "Task #1 created successfully: Ship",
    },
    // No input (an older server): skipped
    { kind: "tool", id: "t2", name: "TodoWrite", summary: "", ts: "" },
  ] as unknown as ChatItem[];
  assert.deepEqual(planFromItems(items), {
    done: 0,
    total: 1,
    items: [{ text: "Ship", status: "todo" }],
  });
});

test("planFromEntries: plan from raw lines, tokens from the latest usage", () => {
  const entries = [
    {
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "a",
            name: "TaskCreate",
            input: { subject: "One" },
          },
        ],
        usage: { input_tokens: 5, cache_read_input_tokens: 100 },
      },
    },
    {
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "a",
            content: [
              { type: "text", text: "Task #1 created successfully: One" },
            ],
          },
        ],
      },
    },
    // A side chain's usage and calls don't count
    {
      type: "assistant",
      isSidechain: true,
      message: { content: [], usage: { input_tokens: 999999 } },
    },
    {
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "b",
            name: "TaskUpdate",
            input: { taskId: "1", status: "completed" },
          },
        ],
        usage: {
          input_tokens: 10,
          cache_creation_input_tokens: 1000,
          cache_read_input_tokens: 40000,
        },
      },
    },
  ];
  assert.deepEqual(planFromEntries(entries), {
    plan: { done: 1, total: 1, items: [{ text: "One", status: "done" }] },
    tokens: 41010,
  });
  assert.deepEqual(planFromEntries([]), { plan: null, tokens: null });
});
