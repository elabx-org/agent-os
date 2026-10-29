"use client";

import { useRef, useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { X, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useDrawerAnimation } from "@/hooks/useDrawerAnimation";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import type { TerminalHandle } from "@/components/Terminal";
import {
  consumeTerminalRun,
  useTerminalRunRequest,
} from "@/stores/scriptTerminal";

const Terminal = dynamic(
  () => import("@/components/Terminal").then((mod) => mod.Terminal),
  { ssr: false }
);

interface ShellDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workingDirectory: string;
  /** The session it belongs to: runs its terminal scripts (M3) */
  sessionId?: string | null;
}

// After the drawer's own cd && clear has gone in
const READY_AFTER_MS = 400;

export function ShellDrawer({
  open,
  onOpenChange,
  workingDirectory,
  sessionId,
}: ShellDrawerProps) {
  const terminalRef = useRef<TerminalHandle | null>(null);
  const hasInitialized = useRef(false);
  // Connected and in the folder: a script's line can go in
  const [ready, setReady] = useState(false);
  const typed = useRef(new Set<string>());
  const runRequest = useTerminalRunRequest(sessionId);
  const { copied, copy } = useCopyToClipboard();

  // Animation
  const isAnimatingIn = useDrawerAnimation(open);

  // When terminal connects, cd to working directory
  const handleConnected = useCallback(() => {
    if (terminalRef.current && workingDirectory && !hasInitialized.current) {
      hasInitialized.current = true;
      // Clear any existing command, cd to directory, and clear screen
      setTimeout(() => {
        terminalRef.current?.sendInput("\x15"); // Ctrl+U to clear line
        setTimeout(() => {
          terminalRef.current?.sendCommand(`cd ${workingDirectory} && clear`);
          setTimeout(() => setReady(true), READY_AFTER_MS);
        }, 50);
      }, 100);
    } else {
      setReady(true);
    }
  }, [workingDirectory]);

  // Reset initialization flag when drawer closes
  useEffect(() => {
    if (!open) {
      hasInitialized.current = false;
      setReady(false);
    }
  }, [open]);

  // A script run from the Scripts sheet or a shortcut (M3): type its line
  // once, then take it off the queue. An empty line only opened the drawer
  // (Show output of a terminal run)
  useEffect(() => {
    if (!open || !ready || !runRequest) return;
    const { runId, shellCommand } = runRequest;
    if (!typed.current.has(runId)) {
      typed.current.add(runId);
      if (shellCommand) terminalRef.current?.sendCommand(shellCommand);
      else terminalRef.current?.focus();
    }
    consumeTerminalRun(runId);
  }, [open, ready, runRequest]);

  if (!open) return null;

  return (
    <div
      className={cn(
        "bg-muted/30 flex h-full flex-col transition-all duration-200 ease-out",
        isAnimatingIn ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground font-mono text-sm">
            {">_"}
          </span>
          <span className="text-muted-foreground truncate text-xs">
            {workingDirectory}
          </span>
          <button
            onClick={() => copy(workingDirectory)}
            className="text-muted-foreground hover:text-foreground flex-shrink-0 p-0.5"
            title="Copy path"
          >
            {copied ? (
              <Check className="h-3 w-3 text-green-500" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </button>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onOpenChange(false)}
          className="h-7 w-7"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Terminal */}
      <div className="flex-1 overflow-hidden">
        <Terminal
          ref={terminalRef}
          onConnected={handleConnected}
          showImageButton={false}
        />
      </div>
    </div>
  );
}
