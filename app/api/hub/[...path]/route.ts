import { NextResponse } from "next/server";
import { askHub, isMachineMode, UpUnavailable } from "@/lib/link/machine";
import { UP_LOCAL_ERRORS, UP_ERRORS } from "@/lib/link/up";

export const dynamic = "force-dynamic";

/** Largest body a session here may send up to the server */
const BODY_MAX = 256 * 1024;
const PREFIX = "/api/hub";

const local = (code: keyof typeof UP_LOCAL_ERRORS) =>
  NextResponse.json(
    { error: UP_LOCAL_ERRORS[code].error, code },
    {
      status: UP_LOCAL_ERRORS[code].status,
      headers: { "Cache-Control": "no-store" },
    }
  );

/**
 * Only a caller on this machine: the Host must be this server's loopback
 * address. That blocks DNS rebinding, and requests that came down the
 * link from the server (those carry the server's host)
 */
function isLocalHost(request: Request): boolean {
  const port = process.env.PORT || "3011";
  const host = request.headers.get("host");
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

/** The body, or null when it is over the cap */
async function readBody(request: Request): Promise<Buffer | null> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > BODY_MAX) return null;
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > BODY_MAX) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

// /api/hub/<path> - a session on this machine asks the server it is linked
// to. The server decides what is allowed (lib/link/up.ts); this only
// carries the request up, always marked as a session's
async function ask(request: Request): Promise<Response> {
  if (!isMachineMode()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!isLocalHost(request)) return local("local_only");

  // The raw path as it came, never rebuilt from the decoded segments
  const url = new URL(request.url);
  const path = url.pathname.slice(PREFIX.length) + url.search;

  const body = request.method === "GET" ? null : await readBody(request);
  if (body === null && request.method !== "GET") {
    return NextResponse.json(
      { error: UP_ERRORS.too_large, code: "too_large" },
      { status: 413 }
    );
  }
  const headers: Record<string, string> = {};
  const type = request.headers.get("content-type");
  if (type) headers["content-type"] = type;
  if (body) headers["content-length"] = String(body.length);

  try {
    const answer = await askHub({
      method: request.method,
      path,
      headers,
      body: body?.length ? body : null,
      signal: request.signal,
    });
    const answerType = answer.headers["content-type"];
    return new Response(
      answer.status === 204 ? null : new Uint8Array(answer.body),
      {
        status: answer.status,
        headers: {
          "Content-Type":
            (Array.isArray(answerType) ? answerType[0] : answerType) ??
            "application/json",
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (error) {
    if (error instanceof UpUnavailable) return local(error.code);
    return local("link_dropped");
  }
}

export const GET = ask;
export const POST = ask;
export const PUT = ask;
export const DELETE = ask;
