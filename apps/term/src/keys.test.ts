import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeKey, shouldPreventDefault } from "./keys.ts";

test("maps nvim-critical keys to terminal sequences", () => {
  assert.equal(encodeKey({ key: "Escape" }), "\x1b");
  assert.equal(encodeKey({ key: "Enter" }), "\r");
  assert.equal(encodeKey({ key: "Backspace" }), "\x7f");
  assert.equal(encodeKey({ key: "Tab" }), "\t");
  assert.equal(encodeKey({ key: "ArrowUp" }), "\x1b[A");
  assert.equal(encodeKey({ key: "[", ctrlKey: true }), "\x1b");
  assert.equal(encodeKey({ key: "c", ctrlKey: true }), "\x03");
  assert.equal(encodeKey({ key: "w", ctrlKey: true }), "\x17");
  assert.equal(encodeKey({ key: "u", ctrlKey: true }), "\x15");
  assert.equal(encodeKey({ key: "l", altKey: true }), "\x1bl");
});

test("ignores IME composing and modifiers-only events", () => {
  assert.equal(encodeKey({ key: "あ", isComposing: true }), null);
  assert.equal(encodeKey({ key: "Shift" }), null);
  assert.equal(encodeKey({ key: "s", metaKey: true }), null);
});

test("prevents the WebView from stealing terminal chords", () => {
  assert.equal(shouldPreventDefault({ key: "Tab" }), true);
  assert.equal(shouldPreventDefault({ key: "w", ctrlKey: true }), true);
  assert.equal(shouldPreventDefault({ key: "s", metaKey: true }), false);
});
