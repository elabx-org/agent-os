import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import os from "os";
import path from "path";
import { Readable } from "stream";

const TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  bmp: "image/bmp",
};

const home = () => process.env.HOME || os.homedir();

/** Where pictures may come from: uploads, and the home the file APIs browse */
function roots(): string[] {
  const out: string[] = [];
  for (const dir of [path.join(os.tmpdir(), "agent-os-screenshots"), home()]) {
    // As given, and where it really is
    out.push(path.resolve(dir));
    try {
      out.push(fs.realpathSync(dir));
    } catch {
      // Not there yet (no upload so far)
    }
  }
  return out;
}

const inside = (file: string, root: string) => {
  const rel = path.relative(root, file);
  return rel === "" ? false : !rel.startsWith("..") && !path.isAbsolute(rel);
};

type Found =
  | { file: string; type: string; stat: fs.Stats }
  | { error: string; status: number };

/** The real file behind the path, if it's an image we may show */
function resolve(raw: string | null): Found {
  if (!raw) return { error: "Path parameter is required", status: 400 };
  const asked = path.resolve(raw.replace(/^~(?=\/|$)/, home()));
  const allowed = (file: string) =>
    !!TYPES[path.extname(file).slice(1).toLowerCase()] &&
    roots().some((root) => inside(file, root));
  const refused = { error: "Not an image this can show", status: 403 };
  // Nothing said about files outside, not even whether they exist
  if (!allowed(asked)) return refused;
  let file: string;
  try {
    // Links followed, so one can't point out of the allowed folders
    file = fs.realpathSync(asked);
  } catch {
    return { error: "File not found", status: 404 };
  }
  if (!allowed(file)) return refused;
  const type = TYPES[path.extname(file).slice(1).toLowerCase()];
  const stat = fs.statSync(file);
  if (!stat.isFile()) return { error: "File not found", status: 404 };
  return { file, type, stat };
}

const etagOf = (stat: fs.Stats) =>
  `"${stat.size.toString(36)}-${Math.floor(stat.mtimeMs).toString(36)}"`;

function headers(found: { type: string; stat: fs.Stats }, etag: string) {
  return {
    "Content-Type": found.type,
    "Content-Length": String(found.stat.size),
    // Private: behind sign-in. Uploads never change; a home file might
    "Cache-Control": "private, max-age=300",
    ETag: etag,
  };
}

/**
 * GET /api/files/image?path=...
 * An attached image's bytes, for the composer's pills and the viewer. Only
 * image files, only from the upload folder or the home folder (403 else).
 * With &meta=1, its size as JSON instead.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const found = resolve(params.get("path"));
  if ("error" in found)
    return NextResponse.json({ error: found.error }, { status: found.status });

  if (params.get("meta"))
    return NextResponse.json({
      name: path.basename(found.file),
      size: found.stat.size,
    });

  const etag = etagOf(found.stat);
  if (request.headers.get("if-none-match") === etag)
    return new Response(null, { status: 304, headers: { ETag: etag } });

  const stream = Readable.toWeb(
    fs.createReadStream(found.file)
  ) as ReadableStream<Uint8Array>;
  return new Response(stream, { headers: headers(found, etag) });
}

export async function HEAD(request: NextRequest) {
  const found = resolve(request.nextUrl.searchParams.get("path"));
  if ("error" in found) return new Response(null, { status: found.status });
  const etag = etagOf(found.stat);
  return new Response(null, { headers: headers(found, etag) });
}
