"use client";

import {
  PageEmpty,
  PageHeader,
  type PageProps,
} from "@/components/WorkspacePage";

/** New session or background agent as a page (stub: p3-new-surfaces) */
export function NewPage(_props: PageProps<"new">) {
  return (
    <>
      <PageHeader title="New" />
      <PageEmpty />
    </>
  );
}
