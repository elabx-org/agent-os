/**
 * Snippets: saved commands and prompts, put into a message box with a tap.
 * One list for every session and device, kept as a preference on the
 * server. They used to live in each browser (localStorage), so each device
 * hands its own over once (reconcile).
 */

export interface Snippet {
  id: string;
  name: string;
  content: string;
}

/** The preference (/api/preferences) the list is saved under */
export const SNIPPETS_PREFERENCE_KEY = "snippets";
/** Where a browser kept its own list before */
export const SNIPPETS_STORAGE_KEY = "terminal-snippets";
/** Set once this browser's own list has been handed to the server */
export const SNIPPETS_SYNCED_KEY = "terminal-snippets-synced";

const DELEGATE: Snippet = {
  id: "default-17",
  name: "Plan, then delegate",
  content:
    "Plan this yourself, then hand each slice to a sub-agent to implement. Review their work before moving on.",
};

export const DEFAULT_SNIPPETS: Snippet[] = [
  // Git shortcuts
  { id: "default-1", name: "Git status", content: "git status" },
  { id: "default-2", name: "Git diff", content: "git diff" },
  { id: "default-3", name: "Git add all", content: "git add -A" },
  { id: "default-4", name: "Git commit", content: 'git commit -m ""' },
  { id: "default-5", name: "Git push", content: "git push" },
  { id: "default-6", name: "Git pull", content: "git pull" },
  // Claude Code prompts
  { id: "default-7", name: "Continue", content: "continue" },
  { id: "default-8", name: "Yes", content: "yes" },
  { id: "default-9", name: "No", content: "no" },
  {
    id: "default-10",
    name: "Explain this",
    content: "explain what this code does",
  },
  { id: "default-11", name: "Fix errors", content: "fix the errors" },
  {
    id: "default-12",
    name: "Run tests",
    content: "run the tests and fix any failures",
  },
  {
    id: "default-13",
    name: "Commit changes",
    content: "commit these changes with a descriptive message",
  },
  DELEGATE,
  // Common commands
  { id: "default-14", name: "List files", content: "ls -la" },
  { id: "default-15", name: "NPM dev", content: "npm run dev" },
  { id: "default-16", name: "NPM install", content: "npm install" },
];

/** A stored value read as a list, null when it isn't one */
export function asSnippets(value: unknown): Snippet[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter(
    (s): s is Snippet =>
      !!s &&
      typeof s.id === "string" &&
      typeof s.name === "string" &&
      typeof s.content === "string"
  );
}

/**
 * The list the server should hold, given what it holds (null: nothing yet),
 * this browser's old list (null: none) and whether this browser has handed
 * its list over before. Returns null when the server's list stands.
 *
 * The first browser's list becomes the shared one (with the newer default
 * added); a later browser adds only what it made itself, so a default
 * deleted on one device doesn't come back from another.
 */
export function reconcile(
  server: Snippet[] | null,
  local: Snippet[] | null,
  synced: boolean
): Snippet[] | null {
  if (!server) {
    const base = local ?? DEFAULT_SNIPPETS;
    return base.some((s) => s.id === DELEGATE.id) ? base : [...base, DELEGATE];
  }
  if (synced || !local) return null;
  const own = local.filter(
    (s) =>
      !s.id.startsWith("default-") &&
      !server.some((t) => t.id === s.id || t.content === s.content)
  );
  return own.length ? [...server, ...own] : null;
}
