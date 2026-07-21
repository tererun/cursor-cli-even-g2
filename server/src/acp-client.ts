import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { EventBus } from "./event-bus.js";
import type { JsonRpcMessage } from "./types.js";

interface PendingRpc {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

interface PendingInteraction {
  rpcId: number | string;
  method: string;
}

export class AcpClient {
  private process?: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private readonly pending = new Map<number, PendingRpc>();
  private readonly interactions = new Map<string, PendingInteraction>();
  private busy = false;
  sessionId = "";

  constructor(
    private readonly cwd: string,
    private readonly events: EventBus,
  ) {}

  async start(existingSessionId?: string): Promise<string> {
    if (this.process) return this.sessionId;

    const executable = process.env.CURSOR_AGENT_PATH || "agent";
    const args = [
      ...(process.env.CURSOR_API_KEY ? ["--api-key", process.env.CURSOR_API_KEY] : []),
      ...(process.env.CURSOR_AUTH_TOKEN ? ["--auth-token", process.env.CURSOR_AUTH_TOKEN] : []),
      "acp",
    ];
    this.process = spawn(executable, args, {
      cwd: this.cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    createInterface({ input: this.process.stdout }).on("line", (line) => this.onLine(line));
    this.process.stderr.on("data", (chunk) => {
      const message = String(chunk).trim();
      if (message) console.error(`[cursor-acp] ${message}`);
    });
    this.process.once("error", (error) => this.fail(error));
    this.process.once("exit", (code, signal) => {
      this.fail(new Error(`Cursor ACP exited (${code ?? signal ?? "unknown"})`));
    });

    await this.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
      clientInfo: { name: "cursor-cli-even-g2", version: "0.1.0" },
    });
    await this.request("authenticate", { methodId: "cursor_login" });

    const result = await this.request(
      existingSessionId ? "session/load" : "session/new",
      existingSessionId
        ? { sessionId: existingSessionId, cwd: this.cwd, mcpServers: [] }
        : { cwd: this.cwd, mcpServers: [] },
    ) as { sessionId?: string };

    this.sessionId = result.sessionId || existingSessionId || "";
    if (!this.sessionId) throw new Error("Cursor ACP did not return a sessionId");
    this.events.emit({ type: "status", sessionId: this.sessionId, state: "ready" });
    return this.sessionId;
  }

  async prompt(text: string): Promise<void> {
    if (!this.sessionId) throw new Error("ACP session is not initialized");
    if (this.busy) throw new Error("This session is already processing a prompt");
    this.busy = true;
    this.events.emit({ type: "status", sessionId: this.sessionId, state: "busy" });
    try {
      const result = await this.request("session/prompt", {
        sessionId: this.sessionId,
        prompt: [{ type: "text", text }],
      }) as { stopReason?: string };
      this.events.emit({
        type: "result",
        sessionId: this.sessionId,
        stopReason: result.stopReason || "end_turn",
      });
      this.events.emit({ type: "status", sessionId: this.sessionId, state: "idle" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.events.emit({ type: "error", sessionId: this.sessionId, message });
      this.events.emit({ type: "status", sessionId: this.sessionId, state: "error", message });
      throw error;
    } finally {
      this.busy = false;
    }
  }

  cancel(): void {
    if (!this.sessionId) return;
    this.notify("session/cancel", { sessionId: this.sessionId });
    for (const [requestId, interaction] of this.interactions) {
      const outcome = interaction.method === "session/request_permission"
        ? { outcome: { outcome: "cancelled" } }
        : { outcome: { outcome: "cancelled" } };
      this.respond(interaction.rpcId, outcome);
      this.interactions.delete(requestId);
    }
  }

  respondToInteraction(requestId: string, result: unknown): void {
    const interaction = this.interactions.get(requestId);
    if (!interaction) throw new Error("Pending interaction was not found");
    this.respond(interaction.rpcId, result);
    this.interactions.delete(requestId);
  }

  close(): void {
    this.process?.kill();
    this.process = undefined;
  }

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    const message = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write(message);
    });
  }

  private notify(method: string, params: Record<string, unknown>): void {
    this.write({ jsonrpc: "2.0", method, params });
  }

  private respond(id: number | string, result: unknown): void {
    this.write({ jsonrpc: "2.0", id, result });
  }

  private write(message: object): void {
    if (!this.process?.stdin.writable) throw new Error("Cursor ACP process is not running");
    this.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private onLine(line: string): void {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      console.error("[cursor-acp] Ignoring non-JSON stdout:", line);
      return;
    }

    if (typeof message.id === "number" && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || "ACP request failed"));
      else pending.resolve(message.result);
      return;
    }

    if (!message.method) return;
    if (message.method === "session/update") {
      this.handleUpdate(message.params);
      return;
    }
    if (message.id !== undefined) {
      this.handleBlockingRequest(message.id, message.method, message.params ?? {});
      return;
    }
    if (message.method.startsWith("cursor/")) {
      this.events.emit({
        type: "task_progress",
        sessionId: this.sessionId,
        method: message.method,
        update: message.params,
      });
    }
  }

  private handleUpdate(params?: Record<string, unknown>): void {
    const update = params?.update as Record<string, unknown> | undefined;
    if (!update) return;
    const kind = String(update.sessionUpdate || "");
    const content = update.content as { text?: string } | undefined;

    if (kind === "agent_message_chunk" && content?.text) {
      this.events.emit({ type: "text_delta", sessionId: this.sessionId, text: content.text });
    } else if (kind === "agent_thought_chunk" && content?.text) {
      this.events.emit({ type: "thought_delta", sessionId: this.sessionId, text: content.text });
    } else if (kind === "tool_call" || kind === "tool_call_update") {
      this.events.emit({ type: "tool", sessionId: this.sessionId, update });
    } else if (kind === "plan") {
      this.events.emit({ type: "plan", sessionId: this.sessionId, plan: update });
    }
  }

  private handleBlockingRequest(
    rpcId: number | string,
    method: string,
    params: Record<string, unknown>,
  ): void {
    const requestId = `${method}:${String(rpcId)}`;
    this.interactions.set(requestId, { rpcId, method });
    if (method === "session/request_permission") {
      this.events.emit({
        type: "permission_request",
        sessionId: this.sessionId,
        requestId,
        request: params,
      });
    } else if (method === "cursor/ask_question") {
      this.events.emit({
        type: "user_question",
        sessionId: this.sessionId,
        requestId,
        request: params,
      });
    } else if (method === "cursor/create_plan") {
      this.events.emit({
        type: "plan_request",
        sessionId: this.sessionId,
        requestId,
        request: params,
      });
    } else {
      this.respond(rpcId, { outcome: { outcome: "cancelled" } });
      this.interactions.delete(requestId);
    }
  }

  private fail(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    if (this.sessionId) {
      this.events.emit({ type: "error", sessionId: this.sessionId, message: error.message });
    }
  }
}
