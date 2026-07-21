import type { BridgeEvent } from "./types.js";

type Listener = (event: BridgeEvent) => void;

export class EventBus {
  private readonly listeners = new Map<string, Set<Listener>>();

  emit(event: BridgeEvent): void {
    for (const listener of this.listeners.get(event.sessionId) ?? []) {
      listener(event);
    }
  }

  subscribe(sessionId: string, listener: Listener): () => void {
    const listeners = this.listeners.get(sessionId) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(sessionId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(sessionId);
    };
  }
}
