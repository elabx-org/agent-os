import { toast } from "sonner";

// Sizes of files this device uploaded, so a new image pill shows its size
// at once instead of after a lookup
const sizes = new Map<string, number>();

/** The size of a file uploaded from this page, if it was */
export const uploadedSize = (path: string) => sizes.get(path);

/** The file's bytes as base64, without building a string byte by byte */
function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Upload a file and return its saved path.
 * Converts the file to base64 and POSTs to /api/files/upload-temp.
 *
 * @param file - The file to upload
 * @param destinationDir - Optional directory to save into. Defaults to a temp directory.
 * @returns The path to the uploaded file, or null if upload failed
 */
export async function uploadFileToTemp(
  file: File,
  destinationDir?: string
): Promise<string | null> {
  const base64 = await toBase64(file);

  const res = await fetch("/api/files/upload-temp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name || `file-${Date.now()}`,
      base64,
      mimeType: file.type || "application/octet-stream",
      ...(destinationDir ? { destinationDir } : {}),
    }),
  });

  const data = await res.json();
  if (data.path) {
    sizes.set(data.path, file.size);
    return data.path;
  }

  console.error("Upload failed:", data.error);
  return null;
}

/**
 * Upload several files at once, in parallel. Returns the saved paths in the
 * order picked; a file that fails is reported on its own and the rest still
 * go through.
 */
export async function uploadFilesToTemp(files: File[]): Promise<string[]> {
  const paths = await Promise.all(
    files.map((file) =>
      uploadFileToTemp(file).catch((err) => {
        console.error("Failed to upload file:", err);
        return null;
      })
    )
  );
  paths.forEach((path, i) => {
    if (!path) toast.error(`Couldn't upload ${files[i].name || "a file"}`);
  });
  return paths.filter((p): p is string => !!p);
}
