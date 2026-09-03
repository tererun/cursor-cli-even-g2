import { createRequire } from "node:module";
import { formatScreen } from "./screen.js";
import type { EventBus } from "./event-bus.js";
import type { PtyHandle, TermSessionRecord } from "./types.js";

const { Terminal } = createRequire(import.meta.url)("@xterm/headless") as typeof import("@xterm/headless");
type HeadlessTerminal = InstanceType<typeof Terminal>;

const FRAME_MS = 50;

export class PtySession {
  private readonly term: HeadlessTerminal;
  private frameTimer?: NodeJS.Timeout;
  private seq = 0;
  private closed = false;

  constructor(
    readonly record: TermSessionRecord,
    private readonly pty: PtyHandle,
    private readonly events: EventBus,
  ) {
    this.term = new Terminal({
      cols: record.cols,
      rows: record.rows,
      allowProposedApi: true,
      scrollback: 0,
    });
    this.pty.onData((data) => {
      this.term.write(data, () => this.scheduleFrame());
    });
    this.pty.onExit(({ exitCode }) => {
      this.flushFrame();
      this.events.emit({ type: "exit", sessionId: record.id, code: exitCode ?? null });
      this.events.emit({
        type: "status",
        sessionId: record.id,
        state: "exited",
        message: `process exited (${exitCode ?? "null"})`,
      });
      this.close();
    });
    this.events.emit({ type: "status", sessionId: record.id, state: "ready" });
    this.scheduleFrame();
  }

  write(data: string): void {
    if (this.closed || !data) return;
    this.pty.write(data);
  }

  resize(cols: number, rows: number): void {
    if (this.closed) return;
    this.record.cols = cols;
    this.record.rows = rows;
    this.record.updatedAt = new Date().toISOString();
    this.term.resize(cols, rows);
    this.pty.resize(cols, rows);
    this.scheduleFrame();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.frameTimer) clearTimeout(this.frameTimer);
    try {
      this.pty.kill();
    } catch {
      // already gone
    }
    this.term.dispose();
  }

  snapshot() {
    const buffer = this.term.buffer.active;
    const lines = Array.from({ length: this.record.rows }, (_, row) => (
      buffer.getLine(row)?.translateToString(false) ?? ""
    ));
    return formatScreen(lines, { x: buffer.cursorX, y: buffer.cursorY }, this.record.cols, this.record.rows);
  }

  private scheduleFrame(): void {
    if (this.closed || this.frameTimer) return;
    this.frameTimer = setTimeout(() => {
      this.frameTimer = undefined;
      this.flushFrame();
    }, FRAME_MS);
  }

  private flushFrame(): void {
    if (this.closed) return;
    const screen = this.snapshot();
    this.events.emit({
      type: "frame",
      sessionId: this.record.id,
      cols: screen.cols,
      rows: screen.rows,
      cursor: screen.cursor,
      lines: screen.lines,
      text: screen.text,
      seq: ++this.seq,
    });
  }
}
