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
    text: "Why am I getting this error?",
  });
  assert.deepEqual(splitImages(`${A} ${B}\nboth broken`), {
    images: [A, B],
    text: "both broken",
  });
});

test("a message with no pictures is left alone", () => {
  const text = "  keep   my spacing ";
  assert.deepEqual(splitImages(text), { images: [], text });
});

test("only pictures: no words", () => {
  assert.deepEqual(splitImages(A), { images: [A], text: "" });
});
