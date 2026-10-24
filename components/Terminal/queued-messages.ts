import type { Terminal as XTerm } from "@xterm/xterm";

const RULE = /^─{10,}/;
const squash = (text: string) => text.replace(/\s+/g, "");

/**
 * Claude Code's input box, read off the screen: the text between the last
 * two rules, and whether Claude is still working. Wrapped and
 * newline-separated lines look alike, so the text is only good for comparing
 * with whitespace ignored.
 */
export function readClaudePrompt(term: XTerm) {
  const buffer = term.buffer.active;
  const lines: string[] = [];
  const bottom = buffer.baseY + term.rows - 1;
  for (let y = bottom; y >= buffer.baseY; y--) {
    lines.unshift(buffer.getLine(y)?.translateToString(true) ?? "");
  }
  const rules = lines.flatMap((line, i) => (RULE.test(line) ? [i] : []));
  if (rules.length < 2) return null;
  const [top, end] = rules.slice(-2);
  const box = lines.slice(top + 1, end);
  if (!/^[❯>]/.test(box[0] ?? "")) return null;
  return {
    text: box.join(" ").replace(/^[❯>]/, ""),
    // The hint sits on the spinner or in the footer, often cut short
    busy: [...lines.slice(0, top), ...lines.slice(end)].some((line) =>
      line.includes("esc to interru")
    ),
  };
}

/**
 * Which of the composer's recent sends Claude put back in its prompt (Esc
 * returns queued messages there, newest last), or null if the prompt holds
 * something else
 */
export function matchQueued(prompt: string, sends: string[]) {
  const target = squash(prompt);
  if (!target) return null;
  for (let k = sends.length; k > 0; k--) {
    const restored = sends.slice(-k);
    if (squash(restored.join("")) === target) return restored;
  }
  return null;
}
