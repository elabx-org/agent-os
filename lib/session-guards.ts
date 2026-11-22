/**
 * Refusals for answers that arrive late or land on the wrong screen. Pure,
 * so the routes and the unit tests share them. Old clients that don't send
 * the new fields get today's behaviour.
 */

import type { PermissionPrompt } from "@/lib/permission-prompt";
import { promptFingerprint } from "@/lib/permission-prompt";

/**
 * True when the answer doesn't fit the prompt on screen now: no prompt, no
 * option at that index, a different label, or a fingerprint that differs
 */
export function staleAnswer(
  prompt: PermissionPrompt | null,
  a: { index: number; label: string; fingerprint?: string }
): boolean {
  if (!prompt) return true;
  const option = prompt.options[a.index];
  if (!option || option.label !== a.label) return true;
  if (
    a.fingerprint !== undefined &&
    a.fingerprint !== promptFingerprint(prompt)
  )
    return true;
  return false;
}

/** A reply that must not land on a permission prompt, and one is up */
export function promptBlocksReply(
  onlyIfNoPrompt: boolean | undefined,
  prompt: PermissionPrompt | null
): boolean {
  return onlyIfNoPrompt === true && prompt !== null;
}

const norm = (t: string) => t.replace(/\s+/g, " ").trim();

/**
 * Whether the option labels the client drew are the ones on screen: the
 * same number of questions and the same labels in each. Without labels
 * (old clients) it matches.
 */
export function askLabelsMatch(
  onScreen: { options: { label: string }[] }[],
  sent: string[][] | undefined
): boolean {
  if (sent === undefined) return true;
  if (!Array.isArray(sent) || sent.length !== onScreen.length) return false;
  return sent.every((labels, i) => {
    const shown = onScreen[i].options;
    return (
      Array.isArray(labels) &&
      labels.length === shown.length &&
      labels.every(
        (l, j) => typeof l === "string" && norm(l) === norm(shown[j].label)
      )
    );
  });
}
