"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { SectionHeader } from "@/components/rows/AgentRow";
import { Button } from "@/components/ui/button";
import { SettingGroup, SettingRow } from "./SettingGroup";

const KEY = ["widget-link"];

async function fetchLink(method: "GET" | "POST"): Promise<string> {
  const res = await fetch("/api/widget/link", { method });
  if (!res.ok) throw new Error(`widget link ${res.status}`);
  return ((await res.json()) as { url: string }).url;
}

/**
 * The link the iOS widgets read from (GET /api/widget with its key): copied
 * here, pasted into the widget's Edit Widget. New link stops the old one.
 */
export function WidgetLink() {
  const client = useQueryClient();
  const { data: url } = useQuery({
    queryKey: KEY,
    queryFn: () => fetchLink("GET"),
    staleTime: Infinity,
  });
  const [confirming, setConfirming] = useState(false);

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Widget link copied");
    } catch {
      toast.error("Couldn't copy the link");
    }
  };

  const renew = async () => {
    setConfirming(false);
    try {
      client.setQueryData(KEY, await fetchLink("POST"));
      toast.success("New widget link. Paste it into each widget.");
    } catch {
      toast.error("Couldn't make a new link");
    }
  };

  return (
    <>
      <SectionHeader className="px-5 pt-4">iPhone widgets</SectionHeader>
      <SettingGroup>
        <SettingRow
          as="div"
          label="Widget link"
          hint="Touch and hold an AgentOS widget, Edit Widget, and paste it"
        >
          <Button size="sm" variant="secondary" disabled={!url} onClick={copy}>
            Copy
          </Button>
        </SettingRow>
        <SettingRow
          as="div"
          label="New link"
          hint={
            confirming
              ? "Widgets with the old link stop updating"
              : "If the link got out"
          }
        >
          {confirming ? (
            <Button size="sm" variant="destructive" onClick={renew}>
              Make new
            </Button>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setConfirming(true)}
            >
              New
            </Button>
          )}
        </SettingRow>
      </SettingGroup>
    </>
  );
}
