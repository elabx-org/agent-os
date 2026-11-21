/**
 * The name the user gives the machine AgentOS itself runs on ("Unraid"),
 * shown beside the linked machines' own names. Unset, it is "the server".
 * No server imports.
 */

export const SERVER_NAME_PREFERENCE_KEY = "server_name";
export const SERVER_NAME_MAX = 40;

/** A name as it is kept: one line, trimmed; null when there is none */
export function normalizeServerName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SERVER_NAME_MAX)
    .trim();
  return name || null;
}

/** Mid-sentence: "It goes back to the server" or "… to Unraid" */
export const serverNameOr = (
  name: string | null | undefined,
  fallback = "the server"
): string => normalizeServerName(name) ?? fallback;
