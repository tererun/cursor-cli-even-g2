import type { BridgeEvent } from "./types.js";

export interface SequencedEvent {
  id: number;
  event: BridgeEvent;
}

type Listener = (event: SequencedEvent) => void;

export class EventBus {
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly history = new Map<string, SequencedEvent[]>();
  private nextId = 1;

  emit(event: BridgeEvent): void {
    const sequenced = { id: this.nextId++, event };
    const history = this.history.get(event.sessionId) ?? [];
    history.push(sequenced);
    if (history.length > 500) history.splice(0, history.length - 500);
    this.history.set(event.sessionId, history);
    for (const listener of this.listeners.get(event.sessionId) ?? []) {
      listener(sequenced);
    }
  }

  subscribe(sessionId: string, listener: Listener, afterId = 0): () => void {
    const listeners = this.listeners.get(sessionId) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(sessionId, listeners);
    for (const event of this.history.get(sessionId) ?? []) {
      if (event.id > afterId) listener(event);
    }
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(sessionId);
    };
  }
}
