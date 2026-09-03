export type SessionKind = "shell" | "ssh" | "nvim";

export interface TermSessionRecord {
  id: string;
  kind: SessionKind;
  title: string;
  cwd: string;
  cols: number;
  rows: number;
  createdAt: string;
  updatedAt: string;
  command?: string;
  ssh?: { user?: string; host: string; port: number };
}

export type TermEvent =
  | {
      type: "frame";
      sessionId: string;
      cols: number;
      rows: number;
      cursor: { x: number; y: number };
      lines: string[];
      text: string;
      seq: number;
    }
  | { type: "status"; sessionId: string; state: "ready" | "exited" | "error"; message?: string }
  | { type: "exit"; sessionId: string; code: number | null }
  | { type: "error"; sessionId: string; message: string };

export interface CreateSessionInput {
  kind?: SessionKind;
  cwd?: string;
  command?: string;
  cols?: number;
  rows?: number;
  ssh?: { user?: string; host?: string; port?: number };
}

export interface PtyHandle {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  onData(listener: (data: string) => void): void;
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): void;
  kill(): void;
}

export type PtyFactory = (options: {
  file: string;
  args: string[];
  cwd: string;
  cols: number;
  rows: number;
  env: NodeJS.ProcessEnv;
}) => PtyHandle;
