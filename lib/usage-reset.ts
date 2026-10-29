/**
 * When a usage window resets, as the Now pill and Settings say it: the time
 * ("4:10 pm") when it resets within a day, else the day ("Mon" short,
 * "Monday" long). Empty for no time.
 */
export function formatReset(
  iso: string | null | undefined,
  {
    style = "short",
    now = new Date(),
  }: { style?: "short" | "long"; now?: Date } = {}
): string {
  // Contract stub: U1.3
  void iso;
  void style;
  void now;
  return "";
}
