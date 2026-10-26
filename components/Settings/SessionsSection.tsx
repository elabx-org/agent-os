"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { sessionKeys } from "@/data/sessions/keys";
import { SettingGroup, SettingRow } from "./SettingGroup";

/** Kill all sessions, kept away from the list; asks before it stops anything */
export function SessionsSection() {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [killing, setKilling] = useState(false);

  const killAll = async () => {
    setKilling(true);
    try {
      await fetch("/api/tmux/kill-all", { method: "POST" });
      await queryClient.invalidateQueries({ queryKey: sessionKeys.list() });
      setConfirming(false);
    } catch (error) {
      console.error("Failed to kill sessions:", error);
    } finally {
      setKilling(false);
    }
  };

  return (
    <SettingGroup>
      <SettingRow
        as="div"
        label={<span className="text-red-500">Kill all sessions</span>}
        hint={
          confirming
            ? "Stop every tmux session now?"
            : "Stops every tmux session. Asks first."
        }
      >
        {confirming ? (
          <span className="flex shrink-0 gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirming(false)}
              disabled={killing}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={killAll}
              disabled={killing}
            >
              {killing ? "Killing..." : "Kill all"}
            </Button>
          </span>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0 text-red-500 hover:text-red-500"
            onClick={() => setConfirming(true)}
          >
            Kill all
          </Button>
        )}
      </SettingRow>
    </SettingGroup>
  );
}
