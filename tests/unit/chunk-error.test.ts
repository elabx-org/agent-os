import { test } from "node:test";
import assert from "node:assert/strict";
import { isChunkFailure } from "../../lib/chunk-error";

test("a missing code file is a chunk failure", () => {
  assert.ok(
    isChunkFailure(
      new Error(
        "Failed to load chunk /_next/static/chunks/4974080963765b8d.js from module 791293"
      )
    )
  );
  const webpack = new Error("Loading chunk 123 failed.");
  webpack.name = "ChunkLoadError";
  assert.ok(isChunkFailure(webpack));
  assert.ok(
    isChunkFailure(
      "TypeError: Failed to fetch dynamically imported module: /x.js"
    )
  );
  assert.ok(isChunkFailure({ message: "Importing a module script failed." }));
});

test("other errors are left alone", () => {
  assert.equal(
    isChunkFailure(new Error("Cannot read properties of null")),
    false
  );
  assert.equal(isChunkFailure(undefined), false);
  assert.equal(isChunkFailure({}), false);
});
