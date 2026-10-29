/**
 * Model names reach an agent's launch line in its tmux shell, and a project's
 * `.agent-os.json` can supply one (M3): only plain names pass, and the
 * providers quote them as well.
 */
const SAFE_MODEL = /^[\w.:/[\]-]{1,100}$/;

export function isSafeModelName(model: unknown): model is string {
  return typeof model === "string" && SAFE_MODEL.test(model);
}
