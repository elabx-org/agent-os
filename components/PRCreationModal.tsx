"use client";

import { useState, useEffect } from "react";
import {
  GitPullRequest,
  Loader2,
  ExternalLink,
  GitBranch,
  ChevronLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface PRData {
  branch: string;
  baseBranch: string;
  existingPR: {
    number: number;
    url: string;
    state: string;
    title: string;
  } | null;
  commits: { hash: string; subject: string }[];
  suggestedTitle: string;
  suggestedBody: string;
}

interface PRCreationModalProps {
  workingDirectory: string;
  onClose: () => void;
  onSuccess?: (prUrl: string) => void;
}

export function PRCreationModal({
  workingDirectory,
  onClose,
  onSuccess,
}: PRCreationModalProps) {
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prData, setPrData] = useState<PRData | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  // Fetch PR data on mount
  useEffect(() => {
    const fetchPRData = async () => {
      try {
        const res = await fetch(
          `/api/git/pr?path=${encodeURIComponent(workingDirectory)}`
        );
        const data = await res.json();

        if (data.error) {
          setError(data.error);
        } else {
          setPrData(data);
          setTitle(data.suggestedTitle);
          setBody(data.suggestedBody);
        }
      } catch {
        setError("Failed to fetch PR data");
      } finally {
        setLoading(false);
      }
    };

    fetchPRData();
  }, [workingDirectory]);

  const handleCreate = async () => {
    if (!title.trim()) {
      setError("Title is required");
      return;
    }

    setCreating(true);
    setError(null);

    try {
      const res = await fetch("/api/git/pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: workingDirectory,
          title: title.trim(),
          description: body,
          baseBranch: prData?.baseBranch,
        }),
      });

      const data = await res.json();

      if (data.error) {
        setError(data.error);
        return;
      }

      if (data.pr?.url) {
        onSuccess?.(data.pr.url);
        // Open PR in new tab
        window.open(data.pr.url, "_blank");
        onClose();
      }
    } catch {
      setError("Failed to create PR");
    } finally {
      setCreating(false);
    }
  };

  // Over the git panel (its parent is `relative`), never under the closed
  // Duo's column the way a fixed overlay would be
  const shell = "bg-background absolute inset-0 z-30 flex flex-col";

  // Show existing PR
  if (prData?.existingPR) {
    return (
      <div className={shell}>
        <Header onClose={onClose} />

        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <GitPullRequest className="text-primary dark:text-meter h-10 w-10" />
          <h2 className="t-head">A pull request is already open</h2>
          <p className="text-muted-foreground text-[14px]">
            #{prData.existingPR.number} {prData.existingPR.title}
          </p>
          <button
            type="button"
            onClick={() => window.open(prData.existingPR!.url, "_blank")}
            className="pill pill-primary active:opacity-80"
          >
            <ExternalLink className="h-4 w-4" />
            Open on GitHub
          </button>
        </div>
      </div>
    );
  }

  const field =
    "w-full bg-transparent text-[15px] outline-0 placeholder:text-muted-foreground/70";

  return (
    <div className={shell}>
      <Header onClose={onClose} />

      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
        </div>
      ) : error && !prData ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
          <p className="text-[14px] text-[var(--del)]">{error}</p>
          <button
            type="button"
            onClick={onClose}
            className="pill pill-secondary active:opacity-80"
          >
            Close
          </button>
        </div>
      ) : (
        <>
          <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto overscroll-contain px-4 pt-1 pb-4">
            {/* Branch into base */}
            <div className="text-muted-foreground flex min-w-0 items-center gap-2 px-1 text-[13px]">
              <GitBranch className="h-4 w-4 flex-none" />
              <span className="truncate font-mono">
                {prData?.branch} → {prData?.baseBranch}
              </span>
            </div>

            <label className="group-card block px-3.5 py-3">
              <span className="text-muted-foreground mb-1 block text-[13px]">
                Title
              </span>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What it does"
                className={field}
              />
            </label>

            <label className="group-card block px-3.5 py-3">
              <span className="text-muted-foreground mb-1 block text-[13px]">
                Description
              </span>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Describe your changes"
                rows={10}
                className={cn(field, "resize-none font-mono text-[13px]")}
              />
            </label>

            {prData && prData.commits.length > 0 && (
              <>
                <h3 className="t-sec">Commits · {prData.commits.length}</h3>
                <div className="group-card">
                  {prData.commits.slice(0, 10).map((commit) => (
                    <div
                      key={commit.hash}
                      className="row min-h-[44px] min-w-0 py-0 text-[14px]"
                    >
                      <span className="text-muted-foreground flex-none font-mono text-[13px]">
                        {commit.hash.slice(0, 7)}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {commit.subject}
                      </span>
                    </div>
                  ))}
                  {prData.commits.length > 10 && (
                    <div className="row text-muted-foreground min-h-[44px] py-0 text-[13px]">
                      {prData.commits.length - 10} more
                    </div>
                  )}
                </div>
              </>
            )}

            {error && (
              <p className="px-1 text-[14px] text-[var(--del)]">{error}</p>
            )}
          </div>

          <div className="flex-none px-4 pt-2 pb-[max(1rem,var(--pane-inset-bottom,env(safe-area-inset-bottom)))]">
            <button
              type="button"
              onClick={handleCreate}
              disabled={creating || !title.trim()}
              className="pill pill-primary w-full active:opacity-80 disabled:opacity-50"
            >
              {creating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <GitPullRequest className="h-4 w-4" />
              )}
              Create pull request
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Header({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex flex-none items-center gap-1.5 px-2 pt-3 pb-2">
      <button
        type="button"
        onClick={onClose}
        aria-label="Back to git"
        className="hover:bg-foreground/[0.06] flex size-[44px] flex-none items-center justify-center rounded-full"
      >
        <ChevronLeft className="h-6 w-6" strokeWidth={2.2} />
      </button>
      <h2 className="t-head min-w-0 flex-1 truncate">New pull request</h2>
    </div>
  );
}
