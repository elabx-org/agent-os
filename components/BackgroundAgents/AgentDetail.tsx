"use client";

import {
  PageEmpty,
  PageHeader,
  type PageProps,
} from "@/components/WorkspacePage";

/** A background agent as a page (stub: p3-agent-page) */
export function AgentDetailPage(_props: PageProps<"agent">) {
  return (
    <>
      <PageHeader title="Background agent" />
      <PageEmpty />
    </>
  );
}
