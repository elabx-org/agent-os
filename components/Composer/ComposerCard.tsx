"use client";

import type { CSSProperties, ReactNode } from "react";
import type { ComposerEngine } from "./useComposer";
import type { ComposerInputProps } from "./ComposerInput";
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
  /** Passed to the textarea (ComposerInput); its element never remounts */
  inputProps?: Omit<ComposerInputProps, "composer">;
  /** The + menu (Terminal: ComposerPlusMenu); default: photos/files/video */
  plus?: ReactNode;
  /** Beside the card, outside it: Fold's Stop pill, the keybar toggle */
  trailing?: ReactNode;
  /** Shown above the card inside the same stack: ReplyContextBar, chips */
  above?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

// M2 contract: props only; U2.4 builds it

/**
 * The one composer (E-Composer): a glass card holding the attachments row,
 * the text and a bottom row of + | mode pill | history | send. Collapsed
 * (Closed-Chat) it is the + circle and a capsule. While held it shows the
 * queue (QueueCard, N-Queue) above the text and Queue instead of Send; the
 * undo notice chip sits on top ("Claude will be told turn 4 was undone ×")
 */
export function ComposerCard(_props: ComposerCardProps) {
  return null;
}
