"use client";

import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useSnapshot } from "valtio";
import { toast } from "sonner";
import { ArrowUp, History, Loader2, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { uploadFilesToTemp } from "@/lib/file-upload";
import { sendWithVideos, videoStore } from "@/stores/videoUploads";
import type { SpreadPages } from "@/components/views/SessionSpread";
import type { ComposerEngine } from "./useComposer";
import { ComposerInput, type ComposerInputProps } from "./ComposerInput";
import { ComposerPopover } from "./ComposerPopover";
import { ComposerChips } from "./ModeChip";
import { VideoPills } from "./VideoPills";
import { QueueCard } from "./QueueCard";
import { modeTone, type ClaudeLive } from "./ClaudeStateBar";
import { PlusSlot, plusButtonClass } from "./plus-slot";
import {
  MODE_PILL,
  composerExpanded,
  holdsSend,
  isQueueOff,
  noticeChipText,
} from "./queue-model";
import type { UseQueue } from "@/hooks/useQueue";
import type { EnqueueResult } from "@/lib/queue/types";

export interface ComposerCardProps {
  composer: ComposerEngine;
  sessionId: string;
  /** "Claude", "Codex"…: the placeholder and the queue caption name it */
  agentName: string;
  /** The session's server queue. With `queue.enabled`, sending goes
      through `queue.send` and Queue replaces Send while it is held */
  queue: UseQueue;
  /** The old send, used while `queue.enabled` is false */
  onSendDirect: (text: string) => void | Promise<void>;
  /** After the server took it (sent or queued): clear the draft, scroll… */
  onSent?: (result: EnqueueResult) => void;
  /** "Reply to Claude" (chat) / "Type into the terminal" */
  placeholder: string;
  /** Passed to the textarea (ComposerInput); its element never remounts.
      The card owns Return (send) and, with `live`, Shift+Tab and Esc: an
      onKeyDown here runs first and can preventDefault to keep a key */
  inputProps?: Omit<ComposerInputProps, "composer">;
  /** The + menu (Terminal: ComposerPlusMenu); default: photos/files/video */
  plus?: ReactNode;
  /** Beside the card, outside it: Fold's Stop pill, the keybar toggle */
  trailing?: ReactNode;
  /** Shown above the card inside the same stack: ReplyContextBar, chips */
  above?: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Claude's live state: the mode pill (a tap cycles it, as Shift+Tab),
      the lines its own TUI holds, Shift+Tab and Esc in the box */
  live?: ClaudeLive;
  /** The bottom row's history button; default: Claude with a folder */
  history?: boolean;
  /** The mode pill, with `live` (default on; the terminal shows Claude's) */
  modePill?: boolean;
  /** Send with nothing typed (the terminal: press Enter); without it an
      empty send does nothing */
  onEmptySend?: () => void;
  /** The open Duo's Two rows: the card on the left page, send and
      `trailing` level with it on the right one */
  pages?: SpreadPages | null;
}

/** A queued message being edited in the box; the draft it replaced */
interface Editing {
  id: number;
  n: number;
  stash: string;
}

/**
 * The one composer (E-Composer): a glass card holding the attachments row,
 * the text and a bottom row of + | mode pill | history | send. Collapsed
 * (Closed-Chat) it is the + circle and a capsule. While held it shows the
 * queue (QueueCard, N-Queue) above the text and Queue instead of Send; the
 * undo notice chip sits on top ("Claude will be told turn 4 was undone ×")
 *
 * Collapsed and open are the same elements with other classes (the
 * wrappers turn `display: contents`), so the textarea is never remounted
 * and iOS keeps the keyboard up through the change.
 */
export function ComposerCard({
  composer,
  sessionId,
  agentName,
  queue,
  onSendDirect,
  onSent,
  placeholder,
  inputProps,
  plus,
  trailing,
  above,
  className,
  style,
  live,
  history,
  modePill = true,
  onEmptySend,
  pages,
}: ComposerCardProps) {
  const { items: videoItems } = useSnapshot(videoStore);
  const videos = videoItems.filter((v) => v.draft === sessionId).length;
  const typed =
    queue.enabled && live?.claude && live.screen?.hasQueued
      ? live.screen.queued
      : [];
  const [editing, setEditing] = useState<Editing | null>(null);
  const expanded = composerExpanded({
    focused: composer.focused,
    text: composer.display,
    attachments: videos + composer.uploading,
    queued: (queue.enabled ? queue.items.length : 0) + typed.length,
    notice: (queue.enabled && !!queue.notice) || !!editing,
  });
  const collapsed = !expanded;
  const held = holdsSend(queue);

  // The text as it is when a message waiting on a video's frames goes
  const textRef = useRef(composer.text);
  textRef.current = composer.text;
  const sendingRef = useRef(false);
  const [sending, setSending] = useState(false);

  /** The send rule: the server queue when it's on, the old send if not */
  const deliver = useCallback(
    async (text: string): Promise<boolean> => {
      // Still loading: try the queue, which says when it's off
      if (queue.enabled || queue.isLoading) {
        try {
          onSent?.(await queue.send(text));
          return true;
        } catch (e) {
          if (!isQueueOff(e)) {
            toast.error(e instanceof Error ? e.message : "Couldn't send");
            return false;
          }
        }
      }
      try {
        await onSendDirect(text);
        return true;
      } catch (e) {
        // Not sent: the draft stays
        toast.error(e instanceof Error ? e.message : "Couldn't send");
        return false;
      }
    },
    [queue, onSendDirect, onSent]
  );

  const clear = useCallback(() => {
    composer.replace("");
    composer.sent();
  }, [composer]);

  const send = useCallback(async () => {
    if (sendingRef.current) return;
    const text = composer.text;
    if (editing) {
      if (!text.trim()) return;
      sendingRef.current = true;
      setSending(true);
      try {
        await queue.edit(editing.id, text);
        composer.replace(editing.stash);
      } catch (e) {
        // Gone or on its way: the text stays here to send as a new one
        toast.error(e instanceof Error ? e.message : "Couldn't change it");
      } finally {
        setEditing(null);
        sendingRef.current = false;
        setSending(false);
      }
      return;
    }
    // With a video: its frames first, once they're ready
    if (videos) {
      sendWithVideos(
        sessionId,
        () => textRef.current,
        (full) => {
          void deliver(full).then((ok) => {
            // Couldn't go: back into an empty box rather than lost
            if (!ok && !textRef.current) composer.replace(full);
          });
        },
        clear
      );
      return;
    }
    if (!text.trim()) {
      onEmptySend?.();
      return;
    }
    sendingRef.current = true;
    setSending(true);
    try {
      // The draft holds the pills' full text: that's what goes
      if (await deliver(text)) {
        // Typed on while it went: keep that
        if (textRef.current === text) clear();
      }
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }, [
    composer,
    editing,
    queue,
    videos,
    sessionId,
    deliver,
    clear,
    onEmptySend,
  ]);

  /** A queued message back into the box, to change and save */
  const startEdit = useCallback(
    (itemId: number, text: string) => {
      const n = queue.items.findIndex((i) => i.id === itemId) + 1;
      setEditing((was) => ({
        id: itemId,
        n,
        stash: was ? was.stash : composer.draft,
      }));
      composer.replace(text);
      composer.textareaRef.current?.focus();
    },
    [queue.items, composer]
  );
  const stopEdit = () => {
    if (!editing) return;
    composer.replace(editing.stash);
    setEditing(null);
  };

  const tone = live?.claude && modePill ? modeTone(live.mode) : undefined;
  const modeName = live?.mode ? MODE_PILL[live.mode] : undefined;
  const showHistory = history ?? (composer.claude && !!composer.cwd);
  const empty = !composer.display.trim() && !videos;

  const keep = (e: { preventDefault: () => void }) => e.preventDefault();

  // Nothing typed in the terminal is Enter, which goes now as ever
  const sendButton =
    held && !editing && !empty ? (
      <button
        type="button"
        onMouseDown={keep}
        onClick={send}
        disabled={sending}
        aria-label={`Queue: sends when ${agentName} is done`}
        className="pill pill-primary flex-none px-4 active:opacity-80 disabled:opacity-60"
      >
        {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Queue"}
      </button>
    ) : (
      <button
        type="button"
        onMouseDown={keep}
        onClick={send}
        disabled={sending}
        // The one accent control on screen, also when it just presses Enter
        aria-label={
          editing ? "Save" : empty && onEmptySend ? "Press Enter" : "Send"
        }
        title={editing ? "Save" : empty && onEmptySend ? "Press Enter" : "Send"}
        className="send-btn touch-manipulation active:opacity-80 disabled:opacity-60"
      >
        {sending ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <ArrowUp className="h-5 w-5" strokeWidth={2.4} />
        )}
      </button>
    );

  const plusNode = plus ?? (
    <AttachButton composer={composer} collapsed={collapsed} />
  );

  return (
    <div
      className={cn("relative", className)}
      style={pages ? { ...style, width: pages.left - 10 } : style}
      onTouchEnd={(e) => e.stopPropagation()}
    >
      <ComposerPopover composer={composer} />
      {above}
      <div className="flex items-end gap-2.5">
        <div
          className={cn(
            collapsed
              ? "contents"
              : "glass composer-card min-w-0 flex-1 overflow-hidden"
          )}
        >
          {!collapsed && editing && (
            <div className="flex items-center gap-2 px-1 text-[13px]">
              <span className="font-semibold text-[#6D28D9] dark:text-[#C4B5FD]">
                Editing queued {editing.n}
              </span>
              <button
                type="button"
                onMouseDown={keep}
                onClick={stopEdit}
                className="text-muted-foreground ml-auto underline-offset-2 hover:underline"
              >
                Cancel
              </button>
            </div>
          )}
          {!collapsed && queue.enabled && queue.notice && (
            <div className="bg-primary/12 flex min-h-9 items-center gap-2 rounded-full py-0.5 pr-0.5 pl-3.5 text-[13px]">
              <span className="min-w-0 flex-1 truncate">
                {noticeChipText(queue.notice.text, agentName)}
              </span>
              <button
                type="button"
                onMouseDown={keep}
                onClick={() =>
                  queue
                    .dropNotice()
                    .catch((e) =>
                      toast.error(
                        e instanceof Error ? e.message : "Couldn't drop it"
                      )
                    )
                }
                aria-label="Don't tell it about the undo"
                className="text-muted-foreground active:bg-foreground/10 flex h-8 w-8 flex-none items-center justify-center rounded-full"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          {!collapsed && queue.enabled && (
            <QueueCard
              queue={queue}
              agentName={agentName}
              typedInTerminal={typed}
              onEdit={startEdit}
            />
          )}
          {!collapsed && (
            <ComposerChips composer={composer} className="px-0 pb-0" />
          )}
          {!collapsed && videos > 0 && <VideoPills draft={sessionId} />}
          <div
            className={cn(
              collapsed ? "contents" : "flex flex-wrap items-center gap-2"
            )}
          >
            <PlusSlot.Provider value={{ collapsed }}>
              {plusNode}
            </PlusSlot.Provider>
            <div
              className={cn(
                collapsed ? "glass composer-field pl-1" : "contents"
              )}
            >
              <ComposerInput
                enterKeyHint="send"
                autoCapitalize="sentences"
                inputClassName="max-h-40"
                autoGrow
                {...inputProps}
                composer={composer}
                plain
                placeholder={placeholder}
                onKeyDown={(e) => {
                  inputProps?.onKeyDown?.(e);
                  if (e.defaultPrevented) return;
                  if (live?.onKeyDown(e)) return;
                  // Return sends (or queues), Shift+Return adds a line
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    void send();
                  }
                }}
                className={cn(
                  // Open: the whole first line, its text in line with the card's
                  collapsed
                    ? "flex-1"
                    : "order-first -mx-3.5 -my-1 basis-[calc(100%+1.75rem)]",
                  inputProps?.className
                )}
              />
              {collapsed && !pages && sendButton}
            </div>
            {!collapsed && tone && modeName && (
              <button
                type="button"
                onMouseDown={keep}
                onClick={live?.cycleMode}
                title="Shift+Tab to cycle"
                aria-label={`Mode: ${modeName}, tap to change`}
                className={cn("mode-pill flex-none", tone.className)}
              >
                {tone.icon}
                {modeName}
              </button>
            )}
            {!collapsed && showHistory && (
              <button
                type="button"
                onMouseDown={keep}
                onClick={() => composer.setHistoryOpen(true)}
                aria-label="Earlier prompts"
                title="Earlier prompts"
                className="text-foreground active:bg-foreground/10 flex h-11 w-11 flex-none items-center justify-center rounded-full"
              >
                <History className="h-5 w-5" />
              </button>
            )}
            {!collapsed && <span className="flex-1" aria-hidden="true" />}
            {!collapsed && !pages && sendButton}
          </div>
        </div>
        {!pages && trailing}
      </div>
      {pages && (
        // On the right page, level with the box: trailing and send at the
        // far end
        <div
          className="absolute bottom-0 flex items-end"
          style={{
            left: `calc(100% + ${pages.gutter}px)`,
            width: pages.right - 10,
          }}
        >
          <div className="ml-auto flex min-h-[52px] shrink-0 items-center gap-2.5">
            {trailing}
            {sendButton}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The chat's +: photos and videos (frames) or any file, uploaded and put in
 * the message
 */
function AttachButton({
  composer,
  collapsed,
}: {
  composer: ComposerEngine;
  collapsed: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const pick = async (files: File[]) => {
    const media = files.filter(
      (f) => f.type.startsWith("image/") || f.type.startsWith("video/")
    );
    const others = files.filter((f) => !media.includes(f));
    // Pictures become pills and videos frames, as when pasted
    if (media.length) void composer.attach(media);
    if (!others.length) return;
    setUploading(true);
    try {
      const paths = await uploadFilesToTemp(others);
      if (paths.length) composer.insert(paths.join(" "), true);
    } catch {
      toast.error("Couldn't upload the file");
    } finally {
      setUploading(false);
    }
  };
  return (
    <>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => fileRef.current?.click()}
        aria-label="Add photo, file or video"
        title="Add photo, file or video"
        className={plusButtonClass(collapsed)}
      >
        {uploading ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <Plus className="h-5 w-5" />
        )}
      </button>
      <input
        ref={fileRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          void pick(files);
        }}
      />
    </>
  );
}
