export type BridgeEvent =
  | { type: "status"; sessionId: string; state: "ready" | "busy" | "idle" | "error"; message?: string }
  | { type: "text_delta"; sessionId: string; text: string }
  | { type: "thought_delta"; sessionId: string; text: string }
  | { type: "tool"; sessionId: string; update: unknown }
  | { type: "plan"; sessionId: string; plan: unknown }
  | { type: "permission_request"; sessionId: string; requestId: string; request: unknown }
  | { type: "user_question"; sessionId: string; requestId: string; request: unknown }
  | { type: "plan_request"; sessionId: string; requestId: string; request: unknown }
  | { type: "task_progress"; sessionId: string; method: string; update: unknown }
  | { type: "result"; sessionId: string; stopReason: string }
  | { type: "error"; sessionId: string; message: string };

export interface SessionRecord {
  id: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
}

export interface JsonRpcMessage {
  jsonrpc?: "2.0";
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}
