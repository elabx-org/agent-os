const DAY_MS = 24 * 60 * 60_000;
const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

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
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";

  if (at.getTime() - now.getTime() < DAY_MS) {
    const hours = at.getHours();
    const minutes = String(at.getMinutes()).padStart(2, "0");
    return `${hours % 12 || 12}:${minutes} ${hours < 12 ? "am" : "pm"}`;
  }
  const day = WEEKDAYS[at.getDay()];
  return style === "long" ? day : day.slice(0, 3);
}
