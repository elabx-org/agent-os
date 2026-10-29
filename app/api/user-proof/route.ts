// GET /api/user-proof - the page the client loads in a hidden iframe; being
// a navigation, server.ts sets the user-proof cookie on the way
export async function GET() {
  return new Response("<!doctype html><title>Agent-OS</title>", {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
