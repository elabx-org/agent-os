/**
 * The files of a drop: real files only (a dropped folder comes as an entry
 * with nothing to upload), pictures and videos apart from the rest
 */
export interface DroppedItem {
  kind: string;
  /** A folder, when the browser says so */
  directory?: boolean;
  file: { name: string; type: string } | null;
}

export function splitDropped<F extends { name: string; type: string }>(
  items: readonly (Omit<DroppedItem, "file"> & { file: F | null })[]
): { media: F[]; others: F[] } {
  const media: F[] = [];
  const others: F[] = [];
  for (const item of items) {
    if (item.kind !== "file" || item.directory || !item.file) continue;
    const type = item.file.type;
    if (type.startsWith("image/") || type.startsWith("video/"))
      media.push(item.file);
    else others.push(item.file);
  }
  return { media, others };
}

/** Whether a drag carries files at all (text and links are left alone) */
export function carriesFiles(types: readonly string[] | undefined): boolean {
  return !!types && [...types].includes("Files");
}
