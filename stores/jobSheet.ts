import { proxy } from "valtio";

/**
 * The job whose details are up (lib/jobs/types.ts), drawn once by
 * JobSheetHost. Opened from a chat's job line and from the Runners page.
 */
export const jobSheetStore = proxy<{ id: string | null }>({ id: null });

export function openJob(id: string): void {
  jobSheetStore.id = id;
}

export function closeJob(): void {
  jobSheetStore.id = null;
}
