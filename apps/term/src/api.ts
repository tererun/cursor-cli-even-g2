export interface TermSession {
  id: string;
  kind: "shell" | "ssh" | "nvim";
  title: string;
  cwd: string;
  cols: number;
  rows: number;
  createdAt: string;
  updatedAt: string;
  command?: string;
  ssh?: { user?: string; host: string; port: number };
}

export interface TermEvent {
  type: string;
  sessionId: string;
  [key: string]: unknown;
}

export interface CreateSessionInput {
  kind: TermSession["kind"];
  cwd: string;
  cols?: number;
  rows?: number;
  command?: string;
  ssh?: { user?: string; host: string; port: number };
}

export class TermApi {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  listSessions(): Promise<TermSession[]> {
    return this.request<{ sessions: TermSession[] }>("/api/sessions").then((result) => result.sessions);
  }

  createSession(input: CreateSessionInput): Promise<TermSession> {
    return this.request("/api/sessions", { method: "POST", body: JSON.stringify(input) });
  }

  input(sessionId: string, data: string): Promise<unknown> {
    return this.request("/api/input", {
      method: "POST",
      body: JSON.stringify({ sessionId, data }),
    });
  }

  close(sessionId: string): Promise<unknown> {
    return this.request("/api/close", {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    });
  }

  async stream(
    sessionId: string,
    onEvent: (event: TermEvent) => void,
    signal: AbortSignal,
  ): Promise<void> {
    let retryMs = 500;
    const cursor = { lastEventId: "" };
    while (!signal.aborted) {
      try {
        await this.streamOnce(sessionId, onEvent, signal, cursor);
        retryMs = 500;
      } catch (error) {
        if (signal.aborted) return;
        console.warn("Event stream disconnected", error);
      }
      await new Promise((resolve) => setTimeout(resolve, retryMs));
      retryMs = Math.min(retryMs * 2, 10_000);
    }
  }

  private async streamOnce(
    sessionId: string,
    onEvent: (event: TermEvent) => void,
    signal: AbortSignal,
    cursor: { lastEventId: string },
  ): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/api/events?sessionId=${encodeURIComponent(sessionId)}`,
      {
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(cursor.lastEventId ? { "Last-Event-ID": cursor.lastEventId } : {}),
        },
        signal,
      },
    );
    if (!response.ok || !response.body) throw new Error(await this.errorMessage(response));

    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += value;
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() || "";
      for (const frame of frames) {
        const lines = frame.split(/\r?\n/);
        const id = lines.find((line) => line.startsWith("id:"))?.slice(3).trim();
        const data = lines
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data || data === "{}") continue;
        try {
          onEvent(JSON.parse(data) as TermEvent);
          if (id) cursor.lastEventId = id;
        } catch (error) {
          console.warn("Ignoring malformed SSE event", error);
        }
      }
    }
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
    if (!response.ok) throw new Error(await this.errorMessage(response));
    return response.json() as Promise<T>;
  }

  private async errorMessage(response: Response): Promise<string> {
    const body = await response.text();
    try {
      return (JSON.parse(body) as { error?: string }).error || `${response.status}`;
    } catch {
      return body || `${response.status} ${response.statusText}`;
    }
  }
}
