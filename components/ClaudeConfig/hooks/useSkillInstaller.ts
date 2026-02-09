import { useState, useCallback } from "react";
import {
  type ConfigScope,
  GLOBAL_SKILLS_DIR,
  projectSkillsDir,
  parseFrontmatter,
} from "../ClaudeConfigDialog.types";

// Convert a GitHub URL to a raw content URL
function toRawUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "github.com") return null;

    // https://github.com/user/repo/blob/branch/path/to/file
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;

    const [user, repo, ...rest] = parts;

    if (rest[0] === "blob" && rest.length >= 3) {
      // /blob/branch/path... → raw URL
      const branch = rest[1];
      const filePath = rest.slice(2).join("/");
      return `https://raw.githubusercontent.com/${user}/${repo}/${branch}/${filePath}`;
    }

    if (rest[0] === "tree" && rest.length >= 2) {
      // /tree/branch/path... → assume SKILL.md in that directory
      const branch = rest[1];
      const dirPath = rest.slice(2).join("/");
      const base = dirPath ? `${dirPath}/` : "";
      return `https://raw.githubusercontent.com/${user}/${repo}/${branch}/${base}SKILL.md`;
    }

    // Bare repo URL → try main branch SKILL.md
    return `https://raw.githubusercontent.com/${user}/${repo}/main/SKILL.md`;
  } catch {
    return null;
  }
}

interface UseSkillInstallerOptions {
  projectPath?: string;
  onInstalled: () => void;
}

export function useSkillInstaller({
  projectPath,
  onInstalled,
}: UseSkillInstallerOptions) {
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const install = useCallback(
    async (url: string, scope: ConfigScope) => {
      setError(null);
      setInstalling(true);

      try {
        const rawUrl = toRawUrl(url.trim());
        if (!rawUrl) {
          setError("Invalid GitHub URL. Use a link to a repo or SKILL.md file.");
          setInstalling(false);
          return;
        }

        // Fetch via server-side proxy (handles auth for private repos)
        const res = await fetch(
          `/api/github-raw?url=${encodeURIComponent(rawUrl)}`
        );

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          setError(
            errData.error || "Failed to fetch from GitHub. Check the URL and repo access."
          );
          setInstalling(false);
          return;
        }

        const data = await res.json();
        const content = (data.content || "").trim();

        if (!content) {
          setError(
            "Could not fetch SKILL.md. Check the URL and ensure the file exists."
          );
          setInstalling(false);
          return;
        }

        // Parse to get skill name
        const { metadata } = parseFrontmatter(content);
        const skillName =
          metadata.name ||
          url
            .split("/")
            .filter(Boolean)
            .pop()
            ?.replace(/\.md$/i, "") ||
          "imported-skill";

        // Sanitize name for directory
        const safeName = skillName.replace(/[^a-zA-Z0-9_-]/g, "-");

        const baseDir =
          scope === "global"
            ? GLOBAL_SKILLS_DIR
            : projectSkillsDir(projectPath || "");

        const dirPath = `${baseDir}/${safeName}`;

        // Write SKILL.md (parent dirs created automatically)
        const writeRes = await fetch("/api/files/content", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            path: `${dirPath}/SKILL.md`,
            content,
          }),
        });

        if (!writeRes.ok) {
          setError("Failed to save skill file.");
          setInstalling(false);
          return;
        }

        onInstalled();
      } catch {
        setError("An error occurred during installation.");
      } finally {
        setInstalling(false);
      }
    },
    [projectPath, onInstalled]
  );

  return { installing, error, install, clearError: () => setError(null) };
}
