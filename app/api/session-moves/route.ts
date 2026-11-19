import { NextResponse } from "next/server";
import { prepareMoveIn } from "@/lib/session-move";
import { moveError, userOnly } from "@/lib/session-move-guard";

export const dynamic = "force-dynamic";

const named = (value: unknown): value is { machine: string; name: string } =>
  !!value &&
  typeof (value as { machine?: unknown }).machine === "string" &&
  typeof (value as { name?: unknown }).name === "string";

// POST /api/session-moves - { manifest, from, self }: gets this machine
// ready for a session from another one; answers its MoveInState
export async function POST(request: Request) {
  const no = userOnly(request);
  if (no) return no;
  const body = (await request.json().catch(() => ({}))) as {
    manifest?: unknown;
    from?: unknown;
    self?: unknown;
  };
  if (!named(body.from) || !named(body.self)) {
    return NextResponse.json({ error: "From where?" }, { status: 400 });
  }
  try {
    return NextResponse.json(
      await prepareMoveIn(body.manifest, body.from, body.self)
    );
  } catch (error) {
    return moveError(error);
  }
}
