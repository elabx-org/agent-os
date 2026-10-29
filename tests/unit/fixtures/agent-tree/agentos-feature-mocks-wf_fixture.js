// A workflow script as the Workflow tool writes it: the tree reads the
// phases its meta declares (agent-tree.test.ts copies it under /tmp)
export const meta = {
  name: "agentos-feature-mocks",
  phases: [{ title: "Design" }, { title: "Critique" }],
};

export default async function run() {}
