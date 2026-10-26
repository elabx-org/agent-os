/**
 * Words Claude Code lights up in its input and acts on when the message is
 * sent. The composer only shows them the same way; the text goes as typed.
 */
export interface MagicWord {
  word: string;
  /** One line for the chip under the box */
  description: string;
}

export const MAGIC_WORDS: MagicWord[] = [
  { word: "ultracode", description: "multi-agent workflow for this message" },
  { word: "ultrathink", description: "deeper thinking" },
];

/** Claude Code's rainbow, left to right */
export const RAINBOW =
  "linear-gradient(90deg, rgb(235 95 87), rgb(245 139 87), rgb(250 195 95), rgb(145 200 130), rgb(130 170 220), rgb(155 130 200), rgb(200 130 180))";

/** Matches any of the words, whole and in any case */
export function magicWordPattern(words: MagicWord[]): RegExp | null {
  if (!words.length) return null;
  const alt = words
    .map((w) => w.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  return new RegExp(`\\b(?:${alt})\\b`, "gi");
}
