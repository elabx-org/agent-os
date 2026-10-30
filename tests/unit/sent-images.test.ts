import { test } from "node:test";
import assert from "node:assert/strict";
import { droppedImages, splitImages } from "../../components/Composer/text";

const A = "/tmp/agent-os-screenshots/1793316200231-6ea7d318-IMG_7721.png";
const B = "/tmp/agent-os-screenshots/1793316200999-1a2b3c4d-IMG_7722.jpeg";

test("pictures all gone at once are offered back", () => {
  assert.deepEqual(droppedImages([A, B], []), [A, B]);
});

test("one picture kept: nothing to offer", () => {
  assert.deepEqual(droppedImages([A, B], [B]), []);
  assert.deepEqual(droppedImages([], []), []);
  assert.deepEqual(droppedImages([], [A]), []);
});

test("a message's pictures come out of its words", () => {
  assert.deepEqual(splitImages(`Why am I getting this error? ${A}`), {
    images: [A],
    pasted: 0,
    text: "Why am I getting this error?",
  });
  assert.deepEqual(splitImages(`${A} ${B}\nboth broken`), {
    images: [A, B],
    pasted: 0,
    text: "both broken",
  });
});

test("a message with no pictures is left alone", () => {
  const text = "  keep   my spacing ";
  assert.deepEqual(splitImages(text), { images: [], pasted: 0, text });
});

test("only pictures: no words", () => {
  assert.deepEqual(splitImages(A), { images: [A], pasted: 0, text: "" });
});

test("pictures named in a reply", async () => {
  const { replyImages } = await import("../../components/Composer/text");
  assert.deepEqual(
    replyImages(
      "Saved `/config/shots/home.png` and (/tmp/a.jpg). Also ~/b.webp.\nNot https://x.dev/c.png or c.png"
    ),
    ["/config/shots/home.png", "/tmp/a.jpg", "~/b.webp"]
  );
});

test("Claude Code's image marks, a path right after one, and a pasted picture", () => {
  assert.deepEqual(
    splitImages(`[Image #8]${A}  is this expected?\n${B} too\n[image]`),
    { images: [A, B], pasted: 1, text: "is this expected?\ntoo" }
  );
});
