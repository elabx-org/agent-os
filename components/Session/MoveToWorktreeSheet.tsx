"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSnapshot } from "valtio";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import type { Session } from "@/lib/db";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";
import { registerNavHandlers } from "@/lib/nav-actions";
import { changesCaption } from "@/lib/worktree-move-types";
import { mobileNavStore } from "@/stores/mobileNav";
import { closeMoveSheet, moveSheetStore } from "@/stores/moveSheet";
import { workspacePageStore } from "@/stores/workspacePage";
import { useWorktreeMove, useWorktreeMoves } from "@/hooks/useWorktreeMove";
import { displayTitle, useListTitles } from "@/hooks/useSessionTitles";
import { Avatar, agentAvatar } from "@/components/a/Avatar";
import { Toggle } from "@/components/Settings/SettingGroup";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  followFolder,
  moveFootnote,
  moveNotes,
  moveSheetView,
  uncommittedLabel,
} from "./move-sheet-model";

/**
 * N-Worktree "Move to a worktree": new branch, worktree folder, "Take my
 * uncommitted changes", what happens per agent, "Move session". On a busy
 * session: "Moves when Claude finishes this turn" and Cancel until it
 * starts. Staged changes: "Unstage or commit first"
 */
export interface MoveToWorktreeSheetProps {
  session: Session;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** After a move ran (not when only scheduled) */
  onMoved?: (session: Session) => void;
}

/**
 * The column's sheet id while this is up: × and ✓ (✓ moves). Until the
 * column spec has a "move" sheet with its own Move session item
 */
const SHEET_ID = "permissions";

export function MoveToWorktreeSheet({
  session,
  open,
  onOpenChange,
  onMoved,
}: MoveToWorktreeSheetProps) {
  // The closed Duo's web column stays beside it, its × in reach
  const { railWidth } = useSnapshot(mobileNavStore);
  const beside = railWidth > 0;
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  // The body's Move, for the column's ✓ (latest form via the ref)
  const confirmRef = useRef<(() => void) | null>(null);
  // Escape while a request runs waits for it
  const sendingRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    mobileNavStore.sheet = SHEET_ID;
    const unregister = registerNavHandlers({
      closeSheet: close,
      confirmSheet: () => confirmRef.current?.(),
    });
    // Escape closes the sheet and goes no further: from the composer's box
    // it would interrupt the agent
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      if (!sendingRef.current) close();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      unregister();
      window.removeEventListener("keydown", onKey, true);
      if (mobileNavStore.sheet === SHEET_ID) mobileNavStore.sheet = null;
    };
  }, [open, close]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className={cn(
          "sheet-surface bg-[var(--sheet)] pb-[max(16px,env(safe-area-inset-bottom))]",
          // Half folded (tabletop): on the base, below the hinge, full width
          "[html[data-fold=horizontal]_&]:top-[calc(var(--fold-end)+0.5rem)] [html[data-fold=horizontal]_&]:mx-0 [html[data-fold=horizontal]_&]:max-h-none [html[data-fold=horizontal]_&]:w-auto [html[data-fold=horizontal]_&]:max-w-none",
          // Book pose without the app (globals.css sets left): the right page
          "[html[data-fold=vertical]_&]:right-0 [html[data-fold=vertical]_&]:mx-0 [html[data-fold=vertical]_&]:w-auto [html[data-fold=vertical]_&]:max-w-none",
          // The open Duo lying flat: on the right page, clear of the hinge
          "[html[data-hinge]_&]:right-0 [html[data-hinge]_&]:left-[calc(var(--hinge-x)+var(--fold-clear))] [html[data-hinge]_&]:mx-0 [html[data-hinge]_&]:w-auto [html[data-hinge]_&]:max-w-none"
        )}
        data-beside-column={beside ? "" : undefined}
        // left 0 + right at the column: w-full would win over right
        style={
          beside
            ? { right: railWidth, width: "auto", maxWidth: "none" }
            : undefined
        }
        onPointerDownOutside={(e) => {
          const target = e.target as Element | null;
          if (target?.closest?.("[data-control-column]")) e.preventDefault();
        }}
      >
        <SheetDescription className="sr-only">
          Move this session into a new git worktree on its own branch,
          optionally taking its uncommitted changes along
        </SheetDescription>
        {open ? (
          <MoveBody
            session={session}
            onClose={close}
            onMoved={onMoved}
            confirmRef={confirmRef}
            sendingRef={sendingRef}
          />
        ) : (
          <SheetTitle className="sr-only">Move to a worktree</SheetTitle>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** One field of the grouped card: a caption over a mono input */
function Field({
  label,
  value,
  onChange,
  disabled,
  ariaLabel,
  invalid,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  ariaLabel: string;
  invalid?: boolean;
}) {
  return (
    <label className="flex min-h-[62px] flex-col justify-center gap-1 px-3.5 py-2.5">
      <span className="text-muted-foreground text-[13px]">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        enterKeyHint="done"
        // Scrolled into view above the keyboard (the sheet's body scrolls)
        onFocus={(e) => {
          const input = e.currentTarget;
          window.setTimeout(
            () => input.scrollIntoView({ block: "nearest" }),
            300
          );
        }}
        className={cn(
          "w-full min-w-0 truncate border-0 bg-transparent p-0 font-mono text-[14px] outline-none disabled:opacity-60",
          invalid && "text-[var(--del)]"
        )}
      />
    </label>
  );
}

/** Mounted while open, so the form starts from the preview each time */
function MoveBody({
  session,
  onClose,
  onMoved,
  confirmRef,
  sendingRef,
}: {
  session: Session;
  onClose: () => void;
  onMoved?: (session: Session) => void;
  confirmRef: React.MutableRefObject<(() => void) | null>;
  sendingRef: React.MutableRefObject<boolean>;
}) {
  const { preview, move, cancel } = useWorktreeMove(session.id, true);
  const moves = useWorktreeMoves();
  const titles = useListTitles([session]);
  const { title } = displayTitle(session, titles);

  // Null until edited: the suggestion (and, for the folder, the branch) leads
  const [branchEdit, setBranchEdit] = useState<string | null>(null);
  const [folderEdit, setFolderEdit] = useState<string | null>(null);
  const [takeEdit, setTakeEdit] = useState<boolean | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const files = preview?.uncommitted ?? [];
  const changes = files.length;
  const branch = branchEdit ?? preview?.suggestedBranch ?? "";
  const folder =
    folderEdit ??
    (preview
      ? followFolder(preview.folderDisplay, preview.suggestedBranch, branch)
      : "");
  const take = changes > 0 && (takeEdit ?? true);
  // The sheet's own poll first; the shared list catches it between
  const pending = preview?.pending ?? moves[session.id] ?? null;

  const view = moveSheetView({ preview, pending, branch, sending });
  const editable = view.editable && !sending;
  const notes = moveNotes(session.agent_type);
  const footnote = preview
    ? moveFootnote({
        currentBranch: preview.currentBranch,
        takeChanges: take,
        changes,
        otherSessions: preview.otherSessions,
      })
    : null;
  const count = uncommittedLabel(changes);

  const run = async () => {
    if (view.action === "none" || sending) return;
    setSending(true);
    sendingRef.current = true;
    setError(null);
    try {
      if (view.action === "cancel") {
        await cancel();
        haptic("success");
        toast("Move cancelled");
        return;
      }
      const folderValue = folder.trim();
      const result = await move({
        branch: branch.trim(),
        ...(folderValue ? { folder: folderValue } : {}),
        takeChanges: take,
      });
      haptic("success");
      if (result.scheduled) {
        // The sheet stays up showing it, with Cancel
        toast(`Moves to ${result.branch} after this turn`);
        return;
      }
      toast(
        result.sourceKept
          ? `Moved to ${result.branch}; the changes stay in the old folder too`
          : `Moved to ${result.branch}`
      );
      onClose();
      onMoved?.(result.session);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
      sendingRef.current = false;
    }
  };
  // The column's ✓ moves; it never cancels a scheduled move
  const runRef = useRef(run);
  runRef.current = run;
  useEffect(() => {
    confirmRef.current = () => {
      if (view.action === "move") void runRef.current();
    };
    return () => {
      confirmRef.current = null;
    };
  }, [confirmRef, view.action]);

  const note = error ?? view.note;
  const noteError = !!error || view.noteError;
  const cancelling = view.kind === "scheduled";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pt-1 [html[data-fold=horizontal]_&]:gap-2.5">
      <div className="min-w-0">
        <SheetTitle className="t-title text-[20px] leading-tight font-bold tracking-normal">
          Move to a worktree
        </SheetTitle>
        <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px]">
          <span className="min-w-0">
            {title}
            {preview && (
              <>
                {" · "}
                {preview.repoName}
                {preview.currentBranch && (
                  <>
                    {" on "}
                    <span className="font-mono text-[12px]">
                      {preview.currentBranch}
                    </span>
                  </>
                )}
              </>
            )}
          </span>
          {count && (
            <span className="text-needs flex items-center gap-[5px]">
              <span
                aria-hidden="true"
                className="bg-needs h-1.5 w-1.5 shrink-0 rounded-full"
              />
              {count}
            </span>
          )}
        </div>
      </div>

      {!preview ? (
        <div className="text-muted-foreground flex items-center gap-2 py-4 text-sm">
          <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> Reading the
          checkout…
        </div>
      ) : (
        <div className="group-card bg-[var(--sheet-fill)] [&>*+*]:border-t [&>*+*]:border-[var(--hair)] dark:[&>*+*]:border-white/[.06]">
          <Field
            label="New branch"
            value={branch}
            onChange={setBranchEdit}
            disabled={!editable}
            ariaLabel="New branch name"
            invalid={view.action === "none" && editable && !!branch.trim()}
          />
          <Field
            label="Worktree folder"
            value={folder}
            onChange={setFolderEdit}
            disabled={!editable}
            ariaLabel="Worktree folder path"
          />
          {changes > 0 && (
            <div className="row">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-base">Take my uncommitted changes</span>
                <span className="text-muted-foreground truncate font-mono text-[12px]">
                  {changesCaption(files)}
                </span>
              </span>
              <Toggle
                checked={take}
                onCheckedChange={setTakeEdit}
                disabled={!editable}
                aria-label="Take my uncommitted changes"
              />
            </div>
          )}
        </div>
      )}

      {/* Half folded the footnote and the button say enough */}
      <div className="flex shrink-0 flex-col gap-2.5 rounded-[20px] bg-[var(--sheet-fill)] px-3.5 py-3 [html[data-fold=horizontal]_&]:hidden">
        {notes.map((n, i) => (
          <div
            key={n.agentType}
            className={cn(
              "flex items-start gap-2.5 text-sm leading-[1.4]",
              i === 0 ? "text-[var(--say)]" : "text-muted-foreground"
            )}
          >
            <Avatar
              {...agentAvatar(n.agentType)}
              size="sm"
              className="h-6 w-6 rounded-[7px] text-[11px]"
            />
            <span>{n.text}</span>
          </div>
        ))}
      </div>

      {footnote && (
        <p className="text-muted-foreground px-1 text-[13px]">
          {footnote.map((part, i) =>
            part.mono ? (
              <span key={i} className="font-mono text-[12px]">
                {part.text}
              </span>
            ) : (
              <span key={i}>{part.text}</span>
            )
          )}
        </p>
      )}

      <div className="sticky bottom-0 mt-auto flex flex-col gap-1.5 bg-[var(--sheet)] pt-1">
        {note && (
          <p
            role={noteError ? "alert" : "status"}
            className={cn(
              "text-center text-[13px]",
              noteError ? "text-[var(--del)]" : "text-muted-foreground"
            )}
          >
            {note}
          </p>
        )}
        <button
          type="button"
          onClick={run}
          disabled={view.action === "none" || sending}
          className={cn(
            "pill h-[52px] w-full rounded-[26px] text-base active:opacity-80 disabled:opacity-50",
            cancelling ? "pill-secondary" : "pill-primary"
          )}
        >
          {(sending || view.kind === "moving") && (
            <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
          )}
          <span className="truncate">{view.label}</span>
        </button>
      </div>
    </div>
  );
}

/**
 * Draws the sheet for moveSheetStore.sessionId when it is `session`
 * (stores/moveSheet.ts), like PermissionSheetHost. The pane's host steps
 * aside while a project page covers the panes: that page draws its own
 */
export function MoveToWorktreeSheetHost({ session }: { session: Session }) {
  const { sessionId } = useSnapshot(moveSheetStore);
  const { page } = useSnapshot(workspacePageStore);
  if (sessionId !== session.id || page?.kind === "project") return null;
  return <HostSheet session={session} />;
}

/**
 * The Project page's host: the sheet for whichever of its sessions the
 * store names
 */
export function MoveToWorktreeSheetPageHost({
  sessions,
}: {
  sessions: Session[];
}) {
  const { sessionId } = useSnapshot(moveSheetStore);
  const session = sessionId
    ? sessions.find((s) => s.id === sessionId)
    : undefined;
  if (!session) return null;
  return <HostSheet session={session} />;
}

function HostSheet({ session }: { session: Session }) {
  return (
    <MoveToWorktreeSheet
      session={session}
      open
      onOpenChange={(open) => {
        if (!open) closeMoveSheet();
      }}
    />
  );
}
