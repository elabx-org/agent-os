"use client";

import {
  PageEmpty,
  PageHeader,
  type PageProps,
} from "@/components/WorkspacePage";

/** Everything waiting on you as a page (stub: Phase 4) */
export function NeedsYouPage(_props: PageProps<"inbox">) {
  return (
    <>
      <PageHeader title="Needs you" />
      <PageEmpty />
    </>
  );
}
