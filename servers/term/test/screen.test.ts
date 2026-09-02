import assert from "node:assert/strict";
import { test } from "node:test";
import { applyCursor, formatScreen, padLine } from "../src/screen.js";

test("padLine pads and clips to the cell budget", () => {
  assert.equal(padLine("ab", 4), "ab  ");
  assert.equal(padLine("abcdef", 4), "abcd");
});

test("applyCursor replaces exactly one cell", () => {
  const lines = applyCursor(["hello", "world"], { x: 1, y: 0 }, 5);
  assert.equal(lines[0], "h█llo");
  assert.equal(lines[1], "world");
});

test("formatScreen joins a stable G2 text frame", () => {
  const frame = formatScreen(["nvim", ""], { x: 0, y: 0 }, 4, 2);
  assert.equal(frame.cols, 4);
  assert.equal(frame.rows, 2);
  assert.equal(frame.text, "█vim\n    ");
});
