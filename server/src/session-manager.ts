import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { AcpClient } from "./acp-client.js";
import type { EventBus } from "./event-bus.js";
import type { SessionRecord } from "./types.js";

export class SessionManager {
  private readonly clients = new Map<string, AcpClient>();
  private readonly starting = new Map<string, Promise<AcpClient>>();
  private records: SessionRecord[] = [];

  constructor(
    private readonly events: EventBus,
    private readonly storePath = process.env.SESSION_STORE
      || resolve(homedir(), ".local/state/cursor-g2/sessions.json"),
  ) {}

  async initialize(): Promise<void> {
    try {
      this.records = JSON.parse(await readFile(this.storePath, "utf8")) as SessionRecord[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.records = [];
    }
  }

  list(): SessionRecord[] {
    return [...this.records].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async create(cwd: string): Promise<SessionRecord> {
    const safeCwd = await this.validateCwd(cwd);
    let client: AcpClient;
    client = new AcpClient(safeCwd, this.events, () => {
      if (this.clients.get(client.sessionId) === client) this.clients.delete(client.sessionId);
    });
    const id = await client.start();
    const now = new Date().toISOString();
    const record = { id, cwd: safeCwd, createdAt: now, updatedAt: now };
    this.clients.set(id, client);
    this.records = [record, ...this.records.filter((item) => item.id !== id)];
    await this.persist();
    return record;
  }

  async prompt(sessionId: string, text: string): Promise<void> {
    const client = await this.getClient(sessionId);
    const record = this.records.find((item) => item.id === sessionId);
    if (record) {
      record.updatedAt = new Date().toISOString();
      await this.persist();
    }
    await client.prompt(text);
  }

  async cancel(sessionId: string): Promise<void> {
    (await this.getClient(sessionId)).cancel();
  }

  async respond(sessionId: string, requestId: string, result: unknown): Promise<void> {
    (await this.getClient(sessionId)).respondToInteraction(requestId, result);
  }

  close(): void {
    for (const client of this.clients.values()) client.close();
    this.clients.clear();
  }

  private async getClient(sessionId: string): Promise<AcpClient> {
    const running = this.clients.get(sessionId);
    if (running) return running;
    const pending = this.starting.get(sessionId);
    if (pending) return pending;
    const record = this.records.find((item) => item.id === sessionId);
    if (!record) throw new Error("Session not found");
    const start = (async () => {
      const cwd = await this.validateCwd(record.cwd);
      let client: AcpClient;
      client = new AcpClient(cwd, this.events, () => {
        if (this.clients.get(sessionId) === client) this.clients.delete(sessionId);
      });
      await client.start(sessionId);
      this.clients.set(sessionId, client);
      return client;
    })();
    this.starting.set(sessionId, start);
    try {
      return await start;
    } finally {
      this.starting.delete(sessionId);
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

  private async persist(): Promise<void> {
    await mkdir(dirname(this.storePath), { recursive: true, mode: 0o700 });
    await writeFile(this.storePath, JSON.stringify(this.records, null, 2), { mode: 0o600 });
  }
}
