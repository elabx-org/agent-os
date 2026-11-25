import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { WHEEL_BINDINGS } from "../../lib/tmux-wheel";
import { generateInitScript } from "../../lib/init-script";

test("a wheel down at the bottom leaves the scroll-back, in both tables", () => {
  for (const table of ["copy-mode", "copy-mode-vi"]) {
    const down = WHEEL_BINDINGS.find((b) =>
      b.startsWith(`bind-key -T ${table} WheelDownPane `)
    );
    assert.ok(down, table);
    // scroll_position is 0 at the bottom, which if-shell -F reads as false
    assert.match(
      down,
      /if-shell -F '#\{scroll_position\}' 'send-keys -X scroll-down' 'send-keys -X cancel'$/
    );
    assert.ok(
      WHEEL_BINDINGS.includes(
        `bind-key -T ${table} WheelUpPane send-keys -X scroll-up`
      )
    );
  }
});

test("every place that sets up tmux uses the same bindings", () => {
  const script = generateInitScript("claude");
  for (const binding of WHEEL_BINDINGS) {
    assert.ok(script.includes(`tmux ${binding} 2>/dev/null`), binding);
  }
  for (const file of ["app/page.tsx", "components/Pane/index.tsx"]) {
    const source = fs.readFileSync(file, "utf8");
    assert.match(source, /WHEEL_BINDINGS\.map/, file);
    assert.doesNotMatch(source, /WheelDownPane send-keys -X scroll-down/, file);
  }
});

test("the jump to the last message starts a scroll-back that ends at the bottom", () => {
  const route = fs.readFileSync(
    "app/api/sessions/[id]/last-message/route.ts",
    "utf8"
  );
  assert.match(route, /tmux\("copy-mode", "-e", "-t", target\)/);
});
