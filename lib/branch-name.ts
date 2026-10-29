/**
 * The Own worktree branch New suggests from the task (E-New, D-New):
 * "Regenerate the development signing profile" → "chore/dev-signing-profile",
 * `<kind>/<up to four words>`. Client safe (lib/git.ts runs git, so it can't
 * be imported by the form).
 */

/** The branch kinds a task can read as; "feat" when nothing says otherwise */
export type BranchKind = "fix" | "feat" | "chore" | "docs" | "refactor";

const BRANCH_KINDS: BranchKind[] = ["fix", "feat", "chore", "docs", "refactor"];

/** The whole name, kind and slash included */
const MAX_LENGTH = 40;
const MAX_WORDS = 4;

// Anywhere in the task: something is wrong, so it's a fix whatever the verb
const FIX_WORDS = new Set([
  "fix",
  "fixes",
  "fixed",
  "fixing",
  "bug",
  "bugs",
  "broken",
  "breaks",
  "crash",
  "crashes",
  "wont",
  "doesnt",
  "dont",
  "cant",
  "isnt",
  "fails",
  "failing",
  "regression",
]);
const DOCS_WORDS = new Set(["docs", "doc", "readme", "documentation"]);
const REFACTOR_WORDS = new Set([
  "refactor",
  "clean",
  "cleanup",
  "tidy",
  "simplify",
]);
// Leading verbs that mean upkeep; deps anywhere does too
const CHORE_VERBS = new Set(["bump", "chore", "upgrade", "regenerate"]);
const CHORE_WORDS = new Set(["deps", "dependencies", "dependency", "lockfile"]);

// Say what to do, not what it's about: a leading one is dropped
const VERBS = new Set([
  "add",
  "make",
  "build",
  "create",
  "implement",
  "support",
  "allow",
  "let",
  "update",
  "change",
  "move",
  "remove",
  "delete",
  "show",
  "hide",
  "use",
  "write",
  ...FIX_WORDS,
  ...REFACTOR_WORDS,
  ...CHORE_VERBS,
]);

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "to",
  "of",
  "in",
  "on",
  "at",
  "for",
  "from",
  "with",
  "by",
  "and",
  "or",
  "but",
  "so",
  "when",
  "while",
  "if",
  "then",
  "is",
  "are",
  "was",
  "be",
  "it",
  "its",
  "this",
  "that",
  "these",
  "those",
  "my",
  "our",
  "your",
  "we",
  "i",
  "you",
  "should",
  "can",
  "could",
  "would",
  "will",
  "into",
  "onto",
  "up",
  "out",
  "open",
  "new",
  "please",
  "just",
  "also",
  "some",
  "all",
]);

// Long words branch names usually shorten
const SHORT: Record<string, string> = {
  development: "dev",
  configuration: "config",
  documentation: "docs",
  dependencies: "deps",
  dependency: "deps",
  application: "app",
  repository: "repo",
  environment: "env",
  production: "prod",
  authentication: "auth",
};

/** Lowercase ASCII words: accents folded, apostrophes closed up ("won't" → "wont") */
function words(task: string): string[] {
  return task
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** What kind of change the task reads as */
export function branchKind(task: string): BranchKind {
  const all = words(task);
  if (all.some((w) => FIX_WORDS.has(w))) return "fix";
  if (all.some((w) => DOCS_WORDS.has(w))) return "docs";
  if (all.some((w) => REFACTOR_WORDS.has(w))) return "refactor";
  if (CHORE_VERBS.has(all[0]) || all.some((w) => CHORE_WORDS.has(w)))
    return "chore";
  return "feat";
}

/** A branch name for the task, or "" when the task is empty */
export function branchFromTask(task: string): string {
  const all = words(task);
  // The leading verb says the kind, not the subject
  const rest = VERBS.has(all[0]) ? all.slice(1) : all;
  const kept = rest
    .filter((w) => !STOP_WORDS.has(w))
    .map((w) => SHORT[w] ?? w)
    .slice(0, MAX_WORDS);
  if (kept.length === 0) return "";

  const prefix = `${branchKind(task)}/`;
  const room = MAX_LENGTH - prefix.length;
  // Whole words while they fit; a first word longer than that is cut
  let slug = kept[0].slice(0, room);
  for (const w of kept.slice(1)) {
    if (slug.length + 1 + w.length > room) break;
    slug += `-${w}`;
  }
  return prefix + slug;
}

/**
 * The branch the server makes from a session's featureName: a name shaped
 * `<kind>/<slug>` (branchFromTask's, or feature/ as the server's own) as it
 * is, anything else as `feature/<slug>` (lib/git.ts generateBranchName)
 */
export function branchForFeature(feature: string): string {
  const name = feature.trim();
  const [kind, slug, ...extra] = name.split("/");
  if (
    !extra.length &&
    (kind === "feature" || BRANCH_KINDS.includes(kind as BranchKind)) &&
    /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug ?? "") &&
    name.length <= 50
  )
    return name;
  return `feature/${name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)}`;
}
