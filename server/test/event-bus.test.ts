import assert from "node:assert/strict";
import { test } from "node:test";
import { EventBus } from "../src/event-bus.js";
import type { BridgeEvent } from "../src/types.js";

test("events are routed only to the matching session", () => {
  const bus = new EventBus();
  const received: BridgeEvent[] = [];
  bus.subscribe("session-a", ({ event }) => received.push(event));

  bus.emit({ type: "text_delta", sessionId: "session-b", text: "ignored" });
  bus.emit({ type: "text_delta", sessionId: "session-a", text: "hello" });

  assert.deepEqual(received, [
    { type: "text_delta", sessionId: "session-a", text: "hello" },
  ]);
});

test("unsubscribe detaches a listener", () => {
  const bus = new EventBus();
  let calls = 0;
  const unsubscribe = bus.subscribe("session-a", () => calls++);
  unsubscribe();
  bus.emit({ type: "status", sessionId: "session-a", state: "idle" });
  assert.equal(calls, 0);
});

test("events after the requested id are replayed on reconnect", () => {
  const bus = new EventBus();
  bus.emit({ type: "text_delta", sessionId: "session-a", text: "old" });
  bus.emit({ type: "text_delta", sessionId: "session-a", text: "new" });
  const received: string[] = [];

  bus.subscribe("session-a", ({ event }) => {
    if (event.type === "text_delta") received.push(event.text);
  }, 1);

  assert.deepEqual(received, ["new"]);
});
