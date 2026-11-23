"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { SetupArt, type SetupArtKind } from "./SetupArt";

export interface SetupStep {
  id: string;
  art: SetupArtKind;
  title: string;
  text: string;
  body: ReactNode;
}

/**
 * Setting a linked machine up one question at a time: a picture, what the
 * step is for, and the same switches its page in Settings has. Nothing is
 * decided by walking through it; each switch saves as it is flipped
 */
export function SetupWalk({
  open,
  onClose,
  server,
  machine,
  steps,
  serverChips,
  machineChips,
}: {
  open: boolean;
  onClose: () => void;
  server: string;
  machine: string;
  steps: SetupStep[];
  serverChips?: string[];
  machineChips?: string[];
}) {
  const [at, setAt] = useState(0);
  useEffect(() => {
    if (open) setAt(0);
  }, [open]);
  const step = steps[Math.min(at, steps.length - 1)];
  const last = at >= steps.length - 1;
  if (!step) return null;
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{step.title}</SheetTitle>
          <SheetDescription>{step.text}</SheetDescription>
        </SheetHeader>
        <SheetBody className="flex flex-col gap-3 pb-4">
          <SetupArt
            kind={step.art}
            server={server}
            machine={machine}
            serverChips={serverChips}
            machineChips={machineChips}
          />
          <div
            key={step.id}
            className="group-card bg-card overflow-hidden rounded-xl [&_.row]:!pl-[14px]"
          >
            {step.body}
          </div>
          <div
            className="flex items-center justify-center gap-1.5 pt-1"
            role="img"
            aria-label={`Step ${at + 1} of ${steps.length}`}
          >
            {steps.map((s, i) => (
              <span
                key={s.id}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i === at ? "bg-primary w-4" : "bg-foreground/20 w-1.5"
                )}
              />
            ))}
          </div>
          <div className="flex gap-2">
            {at > 0 && (
              <button
                type="button"
                onClick={() => setAt(at - 1)}
                className="pill pill-secondary h-[52px] flex-none rounded-[26px] px-6 text-base active:opacity-80"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={() => (last ? onClose() : setAt(at + 1))}
              className="pill pill-primary h-[52px] min-w-0 flex-1 rounded-[26px] text-base active:opacity-80"
            >
              {last ? "Done" : "Continue"}
            </button>
          </div>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
