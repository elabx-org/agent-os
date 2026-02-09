"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Download,
  Loader2,
  Check,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { GLOBAL_SKILLS_DIR, parseFrontmatter } from "./ClaudeConfigDialog.types";

interface StoreSkill {
  name: string;
  dirName: string;
  description: string;
  url: string; // GitHub tree URL
  rawBaseUrl: string; // raw.githubusercontent.com base
  files: string[]; // file names in the skill directory
}

interface SkillStoreProps {
  installedSkillNames: string[];
  onInstalled: () => void;
}

const GITHUB_API = "https://api.github.com/repos/anthropics/skills/contents";
const GITHUB_RAW = "https://raw.githubusercontent.com/anthropics/skills/main";
const GITHUB_TREE = "https://github.com/anthropics/skills/tree/main/skills";

export function SkillStore({ installedSkillNames, onInstalled }: SkillStoreProps) {
  const [skills, setSkills] = useState<StoreSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const fetchSkills = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Fetch the skills directory listing
      const res = await fetch(`${GITHUB_API}/skills`, {
        headers: { Accept: "application/vnd.github.v3+json" },
      });

      if (!res.ok) {
        // If rate limited, try via our exec proxy
        if (res.status === 403) {
          const proxyRes = await fetch("/api/exec", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              command: `curl -fsSL '${GITHUB_API}/skills' -H 'Accept: application/vnd.github.v3+json'`,
            }),
          });
          if (proxyRes.ok) {
            const proxyData = await proxyRes.json();
            const dirs = JSON.parse(proxyData.output || "[]");
            await loadSkillDetails(dirs);
            return;
          }
        }
        throw new Error("Failed to fetch skills catalog");
      }

      const dirs = await res.json();
      await loadSkillDetails(dirs);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load skills store"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  async function loadSkillDetails(
    dirs: Array<{ name: string; type: string; url: string }>
  ) {
    const skillDirs = dirs.filter((d) => d.type === "dir");
    const loadedSkills: StoreSkill[] = [];

    // Fetch SKILL.md for each to get description
    await Promise.all(
      skillDirs.map(async (dir) => {
        try {
          const rawUrl = `${GITHUB_RAW}/skills/${dir.name}/SKILL.md`;
          const mdRes = await fetch(rawUrl);
          if (!mdRes.ok) return;

          const content = await mdRes.text();
          const { metadata } = parseFrontmatter(content);

          // Also fetch file listing for this skill
          let files: string[] = ["SKILL.md"];
          try {
            const filesRes = await fetch(dir.url, {
              headers: { Accept: "application/vnd.github.v3+json" },
            });
            if (filesRes.ok) {
              const fileEntries = await filesRes.json();
              files = fileEntries
                .filter((f: { type: string }) => f.type === "file")
                .map((f: { name: string }) => f.name);
            }
          } catch {
            // Just use SKILL.md
          }

          loadedSkills.push({
            name: metadata.name || dir.name,
            dirName: dir.name,
            description: metadata.description || "",
            url: `${GITHUB_TREE}/${dir.name}`,
            rawBaseUrl: `${GITHUB_RAW}/skills/${dir.name}`,
            files,
          });
        } catch {
          // Skip skills we can't fetch
        }
      })
    );

    // Sort alphabetically
    loadedSkills.sort((a, b) => a.name.localeCompare(b.name));
    setSkills(loadedSkills);
  }

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  const handleInstall = useCallback(
    async (skill: StoreSkill) => {
      setInstalling(skill.dirName);

      try {
        const dirPath = `${GLOBAL_SKILLS_DIR}/${skill.dirName}`;

        // Create directory
        await fetch("/api/exec", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command: `mkdir -p '${dirPath}'` }),
        });

        // Download all files
        for (const file of skill.files) {
          const rawUrl = `${skill.rawBaseUrl}/${file}`;

          // Fetch via server to avoid CORS on some files
          const res = await fetch("/api/exec", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              command: `curl -fsSL '${rawUrl}'`,
            }),
          });

          if (res.ok) {
            const data = await res.json();
            const content = data.output || "";
            if (content) {
              await fetch("/api/files/content", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  path: `${dirPath}/${file}`,
                  content,
                }),
              });
            }
          }
        }

        toast.success(`Installed "${skill.name}"`);
        onInstalled();
      } catch {
        toast.error(`Failed to install "${skill.name}"`);
      } finally {
        setInstalling(null);
      }
    },
    [onInstalled]
  );

  const filteredSkills = search.trim()
    ? skills.filter(
        (s) =>
          s.name.toLowerCase().includes(search.toLowerCase()) ||
          s.description.toLowerCase().includes(search.toLowerCase())
      )
    : skills;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
        <p className="text-muted-foreground text-sm">
          Loading skills from Anthropic...
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16">
        <p className="text-destructive text-sm">{error}</p>
        <Button variant="outline" size="sm" onClick={fetchSkills} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Search + header */}
      <div className="border-b px-3 py-2">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="text-muted-foreground text-xs">
            {skills.length} official skills from{" "}
            <a
              href="https://github.com/anthropics/skills"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary inline-flex items-center gap-0.5 hover:underline"
            >
              anthropics/skills
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          </span>
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={fetchSkills}
            title="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search skills..."
          className="h-8 text-xs"
        />
      </div>

      {/* Skills grid */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {filteredSkills.map((skill) => {
            const isInstalled = installedSkillNames.includes(skill.dirName);
            const isInstalling = installing === skill.dirName;

            return (
              <div
                key={skill.dirName}
                className="border-border hover:border-border/80 hover:bg-accent/50 flex flex-col rounded-lg border p-3 transition-colors"
              >
                <div className="mb-1 flex items-start gap-2">
                  <span className="text-sm font-medium">{skill.name}</span>
                  {isInstalled && (
                    <span className="bg-primary/10 text-primary flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium">
                      <Check className="h-2.5 w-2.5" />
                      Installed
                    </span>
                  )}
                </div>
                {skill.description && (
                  <p className="text-muted-foreground mb-2 line-clamp-2 flex-1 text-xs">
                    {skill.description}
                  </p>
                )}
                <div className="flex items-center gap-1.5">
                  <Button
                    variant={isInstalled ? "outline" : "default"}
                    size="sm"
                    className="h-7 gap-1 text-xs"
                    disabled={isInstalling}
                    onClick={() => handleInstall(skill)}
                  >
                    {isInstalling ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Download className="h-3 w-3" />
                    )}
                    {isInstalled
                      ? "Reinstall"
                      : isInstalling
                        ? "Installing..."
                        : "Install"}
                  </Button>
                  <a
                    href={skill.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5 text-xs transition-colors"
                  >
                    View
                    <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                </div>
              </div>
            );
          })}
        </div>

        {filteredSkills.length === 0 && (
          <p className="text-muted-foreground py-8 text-center text-sm">
            No skills match &quot;{search}&quot;
          </p>
        )}
      </div>
    </div>
  );
}
