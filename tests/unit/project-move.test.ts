import assert from "node:assert/strict";
import { test } from "node:test";
import {
  projectMoveSummary,
  validCard,
  type ProjectCard,
  type ProjectMoveJob,
} from "../../lib/project-move-types";

const card: ProjectCard = {
  name: "Tide",
  agentType: "claude",
  defaultModel: "sonnet",
  initialPrompt: null,
  instructions: "Metres.",
  group: null,
  devServers: [
    {
      name: "web",
      type: "node",
      command: "npm run dev",
      port: 3000,
      portEnvVar: null,
    },
  ],
};

test("project move: a card is checked before another machine uses it", () => {
  assert.equal(validCard(card), true);
  assert.equal(validCard({ ...card, name: "  " }), false);
  assert.equal(validCard({ ...card, instructions: 5 }), false);
  assert.equal(validCard({ ...card, devServers: "x" }), false);
  assert.equal(
    validCard({
      ...card,
      devServers: [{ ...card.devServers[0], port: 70000 }],
    }),
    false
  );
  assert.equal(validCard(null), false);
});

test("project move: the last line counts what moved and what didn't", () => {
  const job = (states: string[], project?: string): ProjectMoveJob => ({
    id: "a",
    from: "hub",
    to: "m_000000000000",
    fromName: "Unraid",
    toName: "Mac Studio",
    projectName: "Tide",
    state: "done",
    steps: [
      ...states.map((state, i) => ({
        kind: "chat" as const,
        sessionId: String(i),
        name: `Chat ${i}`,
        state: state as "done",
      })),
      ...(project
        ? [{ kind: "project" as const, name: "Tide", state: project as "done" }]
        : []),
    ],
  });
  assert.equal(
    projectMoveSummary(job(["done", "done"])),
    "2 chats moved to Mac Studio"
  );
  assert.equal(
    projectMoveSummary(job(["done", "failed"])),
    "1 chat moved to Mac Studio, 1 didn't"
  );
  assert.equal(projectMoveSummary(job(["failed"])), "1 chat didn't move");
  assert.equal(
    projectMoveSummary(job([], "done")),
    "Tide is on Mac Studio now"
  );
  assert.equal(
    projectMoveSummary(job([], "failed")),
    "Tide couldn't be set up on Mac Studio"
  );
});
