/**
 * Where the user's last message starts in Claude Code's output: a row that
 * opens with its prompt mark ("> ", "❯ ", "› "). The input box at the bottom
 * has the same mark, between two rules, so a mark right under a rule isn't
 * a message.
 */

const PROMPT = /^\s{0,2}[>❯›]\s+\S/;
const RULE = /^\s*[─━╌—-]{8,}\s*$/;

/** The row of the last sent message among these, or -1 */
export function lastPromptRow(rows: string[]): number {
  for (let r = rows.length - 1; r >= 0; r--) {
    if (!PROMPT.test(rows[r])) continue;
    if (r > 0 && RULE.test(rows[r - 1])) continue;
    return r;
  }
  return -1;
}
