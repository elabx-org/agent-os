"use client";

import { useState } from "react";
import {
  Plus,
  Minus,
  Loader2,
  MessageSquare,
  Check,
  X,
  GitMerge,
  FileCode,
  ExternalLink,
  ChevronDown,
  Send,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DiffView } from "@/components/DiffViewer/DiffModal";
import {
  usePRDetail,
  usePRComments,
  usePRFileDiff,
  useSubmitPRReview,
  useMergePR,
  useAddPRComment,
} from "@/data/git/queries";

interface PRReviewProps {
  workingDirectory: string;
  prNumber: number;
}

export function PRReview({ workingDirectory, prNumber }: PRReviewProps) {
  const { data: pr, isPending, isError } = usePRDetail(workingDirectory, prNumber);
  const { data: comments = [] } = usePRComments(workingDirectory, prNumber);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const { data: fileDiff } = usePRFileDiff(
    workingDirectory,
    prNumber,
    selectedFile
  );

  const reviewMutation = useSubmitPRReview(workingDirectory, prNumber);
  const mergeMutation = useMergePR(workingDirectory, prNumber);
  const commentMutation = useAddPRComment(workingDirectory, prNumber);

  const [reviewMode, setReviewMode] = useState<
    "APPROVE" | "REQUEST_CHANGES" | "COMMENT" | null
  >(null);
  const [reviewBody, setReviewBody] = useState("");
  const [commentText, setCommentText] = useState("");
  const [showMergeMenu, setShowMergeMenu] = useState(false);

  if (isPending) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (isError || !pr) {
    return (
      <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center p-4">
        <AlertCircle className="mb-2 h-6 w-6" />
        <p className="text-sm">Failed to load PR details</p>
      </div>
    );
  }

  const handleSubmitReview = () => {
    if (!reviewMode) return;
    reviewMutation.mutate(
      { event: reviewMode, body: reviewBody || undefined },
      {
        onSuccess: () => {
          setReviewMode(null);
          setReviewBody("");
        },
      }
    );
  };

  const handleMerge = (method: "merge" | "squash" | "rebase") => {
    setShowMergeMenu(false);
    mergeMutation.mutate(method);
  };

  const handleAddComment = () => {
    if (!commentText.trim()) return;
    commentMutation.mutate(commentText.trim(), {
      onSuccess: () => setCommentText(""),
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* PR Header */}
      <div className="border-border space-y-2 border-b p-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-medium leading-tight">{pr.title}</h3>
            <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-2 text-xs">
              <span>{pr.author}</span>
              <span>·</span>
              <span>
                {pr.baseRefName} ← {pr.headRefName}
              </span>
              <span>·</span>
              <span className="text-green-500">+{pr.additions}</span>
              <span className="text-red-500">-{pr.deletions}</span>
              <span>·</span>
              <span>{pr.changedFiles} files</span>
            </div>
          </div>
          <button
            onClick={() => window.open(pr.url, "_blank")}
            className="text-muted-foreground hover:text-foreground flex-shrink-0"
            title="Open on GitHub"
          >
            <ExternalLink className="h-4 w-4" />
          </button>
        </div>

        {/* Status badges */}
        <div className="flex flex-wrap gap-1.5">
          <StatusBadge
            label={pr.state}
            variant={pr.state === "OPEN" ? "green" : pr.state === "MERGED" ? "purple" : "red"}
          />
          {pr.reviewDecision && (
            <StatusBadge
              label={pr.reviewDecision.replace(/_/g, " ")}
              variant={
                pr.reviewDecision === "APPROVED"
                  ? "green"
                  : pr.reviewDecision === "CHANGES_REQUESTED"
                    ? "red"
                    : "yellow"
              }
            />
          )}
          {pr.mergeable === "MERGEABLE" && (
            <StatusBadge label="Mergeable" variant="green" />
          )}
          {pr.mergeable === "CONFLICTING" && (
            <StatusBadge label="Conflicts" variant="red" />
          )}
        </div>
      </div>

      {/* File list + diff */}
      <div className="flex min-h-0 flex-1">
        {/* File list sidebar */}
        <div className="border-border w-56 flex-shrink-0 overflow-y-auto border-r">
          {pr.files.map((file) => (
            <button
              key={file.path}
              onClick={() => setSelectedFile(file.path)}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                selectedFile === file.path
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-muted/50"
              }`}
            >
              <FileCode className="text-muted-foreground h-3.5 w-3.5 flex-shrink-0" />
              <span className="min-w-0 flex-1 truncate">{file.path}</span>
              <span className="flex-shrink-0">
                {file.additions > 0 && (
                  <span className="text-green-500">+{file.additions}</span>
                )}
                {file.deletions > 0 && (
                  <span className="ml-0.5 text-red-500">
                    -{file.deletions}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>

        {/* Diff view */}
        <div className="flex min-w-0 flex-1 flex-col">
          {selectedFile && fileDiff !== undefined ? (
            <div className="flex-1 overflow-auto p-3">
              <DiffView diff={fileDiff} fileName={selectedFile} />
            </div>
          ) : (
            <div className="text-muted-foreground flex flex-1 flex-col items-center justify-center">
              <FileCode className="mb-3 h-10 w-10 opacity-50" />
              <p className="text-sm">Select a file to view diff</p>
            </div>
          )}
        </div>
      </div>

      {/* Comments + Actions bar */}
      <div className="border-border border-t">
        {/* Comments preview */}
        {comments.length > 0 && (
          <div className="max-h-32 overflow-y-auto px-3 pt-2">
            {comments.slice(-3).map((c) => (
              <div key={c.id} className="mb-1.5 text-xs">
                <span className="font-medium">{c.author}</span>
                {c.path && (
                  <span className="text-muted-foreground ml-1">
                    on {c.path}
                  </span>
                )}
                <span className="text-muted-foreground ml-1">
                  · {formatDate(c.createdAt)}
                </span>
                <p className="text-muted-foreground mt-0.5 line-clamp-2">
                  {c.body}
                </p>
              </div>
            ))}
            {comments.length > 3 && (
              <p className="text-muted-foreground mb-1 text-xs">
                +{comments.length - 3} more comments
              </p>
            )}
          </div>
        )}

        {/* Comment input */}
        <div className="flex items-center gap-2 px-3 py-2">
          <input
            type="text"
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddComment()}
            placeholder="Add a comment..."
            className="bg-muted placeholder:text-muted-foreground flex-1 rounded px-2.5 py-1.5 text-xs"
          />
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={handleAddComment}
            disabled={!commentText.trim() || commentMutation.isPending}
          >
            {commentMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>

        {/* Review actions */}
        {reviewMode ? (
          <div className="border-border space-y-2 border-t px-3 py-2">
            <textarea
              value={reviewBody}
              onChange={(e) => setReviewBody(e.target.value)}
              placeholder={
                reviewMode === "APPROVE"
                  ? "Optional approval message..."
                  : reviewMode === "REQUEST_CHANGES"
                    ? "Describe requested changes..."
                    : "Review comment..."
              }
              className="bg-muted placeholder:text-muted-foreground w-full resize-none rounded p-2 text-xs"
              rows={2}
            />
            <div className="flex items-center justify-between">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setReviewMode(null);
                  setReviewBody("");
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSubmitReview}
                disabled={
                  reviewMutation.isPending ||
                  (reviewMode === "REQUEST_CHANGES" && !reviewBody.trim())
                }
                className={
                  reviewMode === "APPROVE"
                    ? "bg-green-600 hover:bg-green-700"
                    : reviewMode === "REQUEST_CHANGES"
                      ? "bg-red-600 hover:bg-red-700"
                      : ""
                }
              >
                {reviewMutation.isPending ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : null}
                {reviewMode === "APPROVE"
                  ? "Approve"
                  : reviewMode === "REQUEST_CHANGES"
                    ? "Request Changes"
                    : "Comment"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="border-border flex items-center gap-1.5 border-t px-3 py-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setReviewMode("APPROVE")}
              className="gap-1 text-green-600"
            >
              <Check className="h-3.5 w-3.5" />
              Approve
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setReviewMode("REQUEST_CHANGES")}
              className="gap-1 text-red-600"
            >
              <X className="h-3.5 w-3.5" />
              Changes
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setReviewMode("COMMENT")}
              className="gap-1"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              Comment
            </Button>

            <div className="flex-1" />

            {/* Merge button */}
            {pr.state === "OPEN" && (
              <div className="relative">
                <div className="flex">
                  <Button
                    size="sm"
                    onClick={() => handleMerge("squash")}
                    disabled={
                      mergeMutation.isPending || pr.mergeable === "CONFLICTING"
                    }
                    className="gap-1 rounded-r-none bg-purple-600 hover:bg-purple-700"
                  >
                    {mergeMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <GitMerge className="h-3.5 w-3.5" />
                    )}
                    Squash & Merge
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setShowMergeMenu(!showMergeMenu)}
                    disabled={
                      mergeMutation.isPending || pr.mergeable === "CONFLICTING"
                    }
                    className="rounded-l-none border-l border-purple-700 bg-purple-600 px-1.5 hover:bg-purple-700"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {showMergeMenu && (
                  <div className="bg-popover border-border absolute bottom-full right-0 mb-1 rounded-md border shadow-md">
                    <button
                      className="hover:bg-accent w-full px-3 py-1.5 text-left text-xs"
                      onClick={() => handleMerge("merge")}
                    >
                      Create merge commit
                    </button>
                    <button
                      className="hover:bg-accent w-full px-3 py-1.5 text-left text-xs"
                      onClick={() => handleMerge("squash")}
                    >
                      Squash and merge
                    </button>
                    <button
                      className="hover:bg-accent w-full px-3 py-1.5 text-left text-xs"
                      onClick={() => handleMerge("rebase")}
                    >
                      Rebase and merge
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({
  label,
  variant,
}: {
  label: string;
  variant: "green" | "red" | "yellow" | "purple";
}) {
  const colors = {
    green: "bg-green-500/10 text-green-500",
    red: "bg-red-500/10 text-red-500",
    yellow: "bg-yellow-500/10 text-yellow-500",
    purple: "bg-purple-500/10 text-purple-500",
  };
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase ${colors[variant]}`}
    >
      {label}
    </span>
  );
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}
