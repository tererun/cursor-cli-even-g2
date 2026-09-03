import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { EventBus } from "./event-bus.js";
import { defaultPtyFactory } from "./pty-factory.js";
import { PtySession } from "./pty-session.js";
import type { CreateSessionInput, PtyFactory, SessionKind, TermSessionRecord } from "./types.js";

const DEFAULT_COMMANDS = ["bash", "zsh", "sh", "fish", "nvim", "vim", "vi", "ssh"];

export class SessionManager {
  private readonly sessions = new Map<string, PtySession>();

  constructor(
    private readonly events: EventBus,
    private readonly ptyFactory: PtyFactory = defaultPtyFactory,
  ) {}

  list(): TermSessionRecord[] {
    return [...this.sessions.values()]
      .map((session) => session.record)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(sessionId: string): PtySession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Session not found");
    return session;
  }

  async create(input: CreateSessionInput): Promise<TermSessionRecord> {
    const kind = input.kind ?? (input.ssh?.host ? "ssh" : "shell");
    const cols = clampSize(input.cols ?? Number(process.env.DEFAULT_COLS || 38), 8, 80);
    const rows = clampSize(input.rows ?? Number(process.env.DEFAULT_ROWS || 12), 4, 24);
    const cwd = await this.validateCwd(input.cwd || process.env.HOME || homedir());
    const { file, args, title, ssh } = this.resolveCommand(kind, input, cwd);
    const id = randomUUID();
    const now = new Date().toISOString();
    const record: TermSessionRecord = {
      id,
      kind,
      title,
      cwd,
      cols,
      rows,
      createdAt: now,
      updatedAt: now,
      command: [file, ...args].join(" "),
      ssh,
    };

    const pty = this.ptyFactory({
      file,
      args,
      cwd,
      cols,
      rows,
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        G2_TERM: "1",
        COLUMNS: String(cols),
        LINES: String(rows),
      },
    });

    const session = new PtySession(record, pty, this.events);
    this.sessions.set(id, session);
    return record;
  }

  write(sessionId: string, data: string): void {
    if (typeof data !== "string" || data.length === 0) return;
    if (data.length > 16_384) throw new Error("Input payload is too large");
    this.get(sessionId).write(data);
    this.get(sessionId).record.updatedAt = new Date().toISOString();
  }

  resize(sessionId: string, cols: number, rows: number): void {
    this.get(sessionId).resize(
      clampSize(cols, 8, 80),
      clampSize(rows, 4, 24),
    );
  }

  close(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.close();
    this.sessions.delete(sessionId);
  }

  closeAll(): void {
    for (const id of [...this.sessions.keys()]) this.close(id);
  }

  private resolveCommand(
    kind: SessionKind,
    input: CreateSessionInput,
    cwd: string,
  ): { file: string; args: string[]; title: string; ssh?: TermSessionRecord["ssh"] } {
    if (kind === "ssh") {
      const host = requireToken(input.ssh?.host, "ssh.host", /^[A-Za-z0-9._:-]+$/);
      this.assertAllowedSshHost(host);
      const user = input.ssh?.user
        ? requireToken(input.ssh.user, "ssh.user", /^[A-Za-z0-9._-]+$/)
        : undefined;
      const port = Number(input.ssh?.port || 22);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("ssh.port is invalid");
      const file = this.allowedFile("ssh");
      const args = ["-tt", "-p", String(port)];
      if (user) args.push("-l", user);
      args.push(host);
      return {
        file,
        args,
        title: user ? `${user}@${host}` : host,
        ssh: { user, host, port },
      };
    }

    if (kind === "nvim") {
      return {
        file: this.allowedFile(input.command || "nvim"),
        args: nvimHudArgs(),
        title: `nvim ${cwd.split("/").filter(Boolean).pop() || cwd}`,
      };
    }

    if (input.command) {
      const file = this.allowedFile(input.command);
      return { file, args: [], title: file };
    }

    const shell = this.allowedFile(process.env.DEFAULT_SHELL || process.env.SHELL || "/bin/bash");
    return { file: shell, args: ["-l"], title: cwd.split("/").filter(Boolean).pop() || shell };
  }

  private allowedFile(command: string): string {
    const trimmed = command.trim();
    if (!trimmed || trimmed.includes(" ") || trimmed.includes("\n")) {
      throw new Error("command must be a single executable name or path");
    }
    const base = trimmed.split(/[\\/]/).pop() || trimmed;
    const allowed = (process.env.ALLOWED_COMMANDS || DEFAULT_COMMANDS.join(","))
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (!allowed.includes(base)) throw new Error(`command is not in ALLOWED_COMMANDS: ${base}`);
    return trimmed;
  }

  private assertAllowedSshHost(host: string): void {
    const allowed = (process.env.ALLOWED_SSH_HOSTS || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (allowed.length && !allowed.includes(host)) {
      throw new Error("ssh host is not in ALLOWED_SSH_HOSTS");
    }
  }

  private async validateCwd(cwd: string): Promise<string> {
    if (!isAbsolute(cwd)) throw new Error("cwd must be an absolute path");
    const normalized = await realpath(resolve(cwd));
    const roots = (process.env.ALLOWED_PROJECT_ROOTS || homedir())
      .split(",")
      .map((root) => root.trim())
      .filter(Boolean);
    const realRoots = await Promise.all(roots.map((root) => realpath(resolve(root))));
    if (!realRoots.some((root) => normalized === root || normalized.startsWith(`${root}${sep}`))) {
      throw new Error("cwd is outside ALLOWED_PROJECT_ROOTS");
    }
    if (!(await stat(normalized)).isDirectory()) throw new Error("cwd is not a directory");
    return normalized;
  }
}

function requireToken(value: unknown, name: string, pattern: RegExp): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  const trimmed = value.trim();
  if (!pattern.test(trimmed)) throw new Error(`${name} is invalid`);
  return trimmed;
}

function clampSize(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function nvimHudArgs(): string[] {
  const g2Lua = resolve(dirname(fileURLToPath(import.meta.url)), "../share/g2.lua");
  if (!existsSync(g2Lua)) return [];
  return ["--cmd", `lua dofile('${g2Lua.replaceAll("'", "")}')`];
}
