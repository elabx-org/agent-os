import { useState, useCallback } from "react";

interface UseCopyToClipboardOptions {
  /** Duration to show copied feedback (ms). Default: 1500 */
  feedbackDuration?: number;
}

interface UseCopyToClipboardReturn {
  /** Whether the copy was successful (shows feedback) */
  copied: boolean;
  /** Copy text to clipboard */
  copy: (text: string) => Promise<boolean>;
}

/**
 * Hook for copying text to clipboard with visual feedback.
 *
 * @example
 * const { copied, copy } = useCopyToClipboard();
 * <button onClick={() => copy(text)}>
 *   {copied ? <Check /> : <Copy />}
 * </button>
 */
export function useCopyToClipboard(
  options: UseCopyToClipboardOptions = {}
): UseCopyToClipboardReturn {
  const { feedbackDuration = 1500 } = options;
  const [copied, setCopied] = useState(false);

  const copy = useCallback(
    async (text: string): Promise<boolean> => {
      if (!text) return false;

      let ok = false;
      try {
        await navigator.clipboard.writeText(text);
        ok = true;
      } catch {
        // No Clipboard API outside https: copy from a selected field instead
        const field = document.createElement("textarea");
        field.value = text;
        field.style.position = "fixed";
        field.style.opacity = "0";
        document.body.appendChild(field);
        field.select();
        try {
          ok = document.execCommand("copy");
        } catch {
          ok = false;
        }
        field.remove();
      }
      if (!ok) return false;
      setCopied(true);
      setTimeout(() => setCopied(false), feedbackDuration);
      return true;
    },
    [feedbackDuration]
  );

  return { copied, copy };
}
