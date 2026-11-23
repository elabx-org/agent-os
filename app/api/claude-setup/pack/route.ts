import { NextResponse } from "next/server";
import { Readable } from "stream";
import { packSetup } from "@/lib/claude-setup/install";
import { readRecord } from "@/lib/claude-setup/inventory";
import { SETUP_FOLLOW_HEADER } from "@/lib/claude-setup/proof";
import { SETUP_KEY } from "@/lib/claude-setup/types";
import { requireUser } from "@/lib/user-proof";

export const dynamic = "force-dynamic";

// GET /api/claude-setup/pack?keys=a,b - this machine's own skills,
// commands and agents of those names, as the tar.gz its server takes an
// edit back with. From the user's own tap, or while this machine's owner
// has "keep matching" on
export async function GET(request: Request) {
  const proof = requireUser(request);
  const following =
    request.headers.get(SETUP_FOLLOW_HEADER) === "1" && readRecord().follow;
  if (!proof.ok && !following) {
    return NextResponse.json(
      { error: "user_only", reason: proof.ok ? undefined : proof.reason },
      { status: 403 }
    );
  }
  const keys = (new URL(request.url).searchParams.get("keys") ?? "")
    .split(",")
    .filter((key) => SETUP_KEY.test(key) && !key.startsWith("plugin:"));
  if (!keys.length) {
    return NextResponse.json({ error: "Nothing was named" }, { status: 400 });
  }
  const pack = await packSetup(keys, "this machine");
  return new Response(Readable.toWeb(pack.stream) as ReadableStream, {
    headers: {
      "Content-Type": "application/gzip",
      "Cache-Control": "no-store",
    },
  });
}
