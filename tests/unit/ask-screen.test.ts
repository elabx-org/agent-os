import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  answerAsk,
  AskError,
  isQuestion,
  parseAskScreen,
  type AskIO,
  type AskQuestionSpec,
  type AskScreen,
} from "../../lib/ask-screen";

const fixture = (name: string) =>
  parseAskScreen(
    readFileSync(
      path.join(__dirname, "fixtures", "ask-screen", `${name}.txt`),
      "utf8"
    ).split("\n")
  );

test("a single-choice question: rows, cursor, no ticks", () => {
  const s = fixture("01-q1");
  assert.equal(s?.kind, "question");
  if (s?.kind !== "question") return;
  assert.equal(s.question, "Where should the cache live?");
  assert.equal(s.multi, false);
  assert.equal(s.cursor, 1);
  assert.deepEqual(
    s.rows.map((r) => [r.n, r.label, r.checked]),
    [
      [1, "SQLite table", null],
      [2, "In memory", null],
      [3, "JSON file", null],
      [4, "Type something.", null],
    ]
  );
});

test("a several-choice question: ticks, and the Submit row", () => {
  const s = fixture("03-multi-1-3");
  if (s?.kind !== "question") return assert.fail("no question");
  assert.equal(s.question, "Which checks should I run?");
  assert.equal(s.multi, true);
  assert.deepEqual(
    s.rows.map((r) => r.checked),
    [true, false, true, false, false]
  );
  assert.equal(fixture("11-q2-typed2")?.kind, "question");
  const typed = fixture("11-q2-typed2");
  if (typed?.kind !== "question") return;
  assert.equal(typed.cursor, 5);
  assert.equal(typed.rows[4].label, "lint");
  assert.equal(typed.rows[4].checked, true);
  const onSubmit = parseAskScreen([
    ...readFileSync(
      path.join(__dirname, "fixtures", "ask-screen", "11-q2-typed2.txt"),
      "utf8"
    )
      .replace("❯ 5. [✔] lint", "  5. [✔] lint")
      .replace("     Submit", "❯    Submit")
      .split("\n"),
  ]);
  assert.equal(onSubmit?.kind === "question" && onSubmit.cursor, "submit");
});

test("Other typed on a single choice, the review, one question alone", () => {
  const typed = fixture("06-q1-typed");
  assert.equal(
    typed?.kind === "question" && typed.rows[3].label,
    "Redis, with a 5s TTL"
  );
  assert.deepEqual(fixture("13-review2"), { kind: "review", cursor: 1 });
  const single = fixture("14-single");
  assert.ok(isQuestion(single, "Ship it?"));
  assert.equal(single?.kind === "question" && single.rows.length, 3);
});

test("no question on screen once it's answered", () => {
  assert.equal(parseAskScreen(["❯ hello", "", "  ? for shortcuts"]), null);
});

// Claude's question screen as recorded: digits pick (single) or tick
// (several), Other takes typing where the ❯ is, Submit moves on, review last
class FakeClaude implements AskIO {
  i = 0;
  picks: Set<number>[];
  other: string[];
  cursor: (number | "submit")[];
  review = false;
  done = false;
  log: string[] = [];
  constructor(
    public qs: (AskQuestionSpec & { labels: string[] })[],
    public stray: string[] = []
  ) {
    this.picks = qs.map(() => new Set());
    this.other = qs.map(() => "");
    this.cursor = qs.map(() => 1);
  }
  async read(): Promise<AskScreen | null> {
    if (this.done) return null;
    if (this.review) return { kind: "review", cursor: 1 };
    const q = this.qs[this.i];
    const rows = [...q.labels, this.other[this.i] || "Type something"].map(
      (label, k) => ({
        n: k + 1,
        label,
        checked: q.multiSelect ? this.picks[this.i].has(k + 1) : null,
      })
    );
    return {
      kind: "question",
      question: q.question,
      multi: q.multiSelect,
      rows,
      cursor: this.cursor[this.i],
    };
  }
  private next() {
    if (this.i < this.qs.length - 1) this.i++;
    else if (this.qs.length > 1) this.review = true;
    else this.done = true;
  }
  async keys(...keys: string[]) {
    for (const k of keys) {
      this.log.push(k);
      if (this.done) {
        this.stray.push(k);
        continue;
      }
      if (this.review) {
        if (k === "1") this.done = true;
        continue;
      }
      const q = this.qs[this.i];
      const otherRow = q.optionCount + 1;
      const c = this.cursor[this.i];
      if (/^\d$/.test(k)) {
        const n = Number(k);
        if (!q.multiSelect) {
          if (n === otherRow) this.cursor[this.i] = n;
          else {
            this.picks[this.i] = new Set([n]);
            this.next();
          }
        } else {
          const p = this.picks[this.i];
          if (p.has(n)) p.delete(n);
          else p.add(n);
        }
      } else if (k === "Down") {
        this.cursor[this.i] =
          c === "submit"
            ? "submit"
            : q.multiSelect && c === otherRow
              ? "submit"
              : Math.min(otherRow, c + 1);
      } else if (k === "Up") {
        this.cursor[this.i] = c === "submit" ? otherRow : Math.max(1, c - 1);
      } else if (k === "Enter") {
        if (c === "submit" || (!q.multiSelect && c === otherRow)) this.next();
        else if (!q.multiSelect) {
          this.picks[this.i] = new Set([c as number]);
          this.next();
        }
      }
    }
  }
  async type(text: string) {
    const q = this.qs[this.i];
    if (this.done || this.review || this.cursor[this.i] !== q.optionCount + 1) {
      this.stray.push(text);
      return;
    }
    this.other[this.i] += text;
    if (q.multiSelect) this.picks[this.i].add(q.optionCount + 1);
  }
  async sleep() {}
}

const STORAGE = {
  question: "Where should the cache live?",
  multiSelect: false,
  optionCount: 3,
  labels: ["SQLite table", "In memory", "JSON file"],
};
const CHECKS = {
  question: "Which checks should I run?",
  multiSelect: true,
  optionCount: 4,
  labels: ["Unit tests", "Typecheck", "Mirror e2e", "iOS compile"],
};

test("two questions, one pick and several ticks, then the review", async () => {
  const claude = new FakeClaude([STORAGE, CHECKS]);
  await answerAsk(
    claude,
    [STORAGE, CHECKS],
    [{ picks: [1] }, { picks: [0, 2] }]
  );
  assert.equal(claude.done, true);
  assert.deepEqual([...claude.picks[0]], [2]);
  assert.deepEqual([...claude.picks[1]].sort(), [1, 3]);
  assert.deepEqual(claude.stray, []);
});

test("your own words on both kinds land in Type something only", async () => {
  const claude = new FakeClaude([STORAGE, CHECKS]);
  await answerAsk(
    claude,
    [STORAGE, CHECKS],
    [
      { picks: [], other: "Redis, with a 5s TTL" },
      { picks: [1], other: "lint\nand format" },
    ]
  );
  assert.equal(claude.done, true);
  assert.equal(claude.other[0], "Redis, with a 5s TTL");
  assert.equal(claude.other[1], "lint and format");
  assert.deepEqual([...claude.picks[1]].sort(), [2, 5]);
  assert.deepEqual(claude.stray, []);
});

test("one question submits on its pick, with no review", async () => {
  const ship = {
    question: "Ship it?",
    multiSelect: false,
    optionCount: 2,
    labels: ["Yes", "No"],
  };
  const claude = new FakeClaude([ship]);
  await answerAsk(claude, [ship], [{ picks: [1] }]);
  assert.equal(claude.done, true);
  assert.deepEqual(claude.log, ["2"]);
});

test("a different question on screen stops before any key", async () => {
  const claude = new FakeClaude([CHECKS]);
  await assert.rejects(
    answerAsk(claude, [STORAGE], [{ picks: [0] }]),
    AskError
  );
  assert.deepEqual(claude.log, []);
});

test("an unanswered question is refused up front", async () => {
  const claude = new FakeClaude([STORAGE]);
  await assert.rejects(answerAsk(claude, [STORAGE], [{ picks: [] }]), AskError);
  assert.deepEqual(claude.log, []);
});
