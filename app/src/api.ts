export interface Session {
  id: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
}

export interface ServerEvent {
  type: string;
  sessionId: string;
  [key: string]: unknown;
}

export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  async listSessions(): Promise<Session[]> {
    const result = await this.request<{ sessions: Session[] }>("/api/sessions");
    return result.sessions;
  }

  createSession(cwd: string): Promise<Session> {
    return this.request("/api/sessions", { method: "POST", body: JSON.stringify({ cwd }) });
  }

  prompt(sessionId: string, text: string): Promise<{ accepted: boolean }> {
    return this.request("/api/prompt", {
      method: "POST",
      body: JSON.stringify({ sessionId, text }),
    });
  }

  permission(sessionId: string, requestId: string, decision: string): Promise<unknown> {
    return this.request("/api/permission-response", {
      method: "POST",
      body: JSON.stringify({ sessionId, requestId, decision }),
    });
  }

  answer(sessionId: string, requestId: string, answers: unknown[]): Promise<unknown> {
    return this.request("/api/question-response", {
      method: "POST",
      body: JSON.stringify({ sessionId, requestId, answers }),
    });
  }

  approvePlan(sessionId: string, requestId: string, accepted: boolean): Promise<unknown> {
    return this.request("/api/plan-response", {
      method: "POST",
      body: JSON.stringify({ sessionId, requestId, accepted }),
    });
  }

  interrupt(sessionId: string): Promise<unknown> {
    return this.request("/api/interrupt", {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    });
  }

  async transcribe(wav: Blob, language = "ja"): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/transcribe?language=${language}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "audio/wav",
      },
      body: wav,
    });
    if (!response.ok) throw new Error(await this.errorMessage(response));
    return ((await response.json()) as { text: string }).text;
  }

  async stream(
    sessionId: string,
    onEvent: (event: ServerEvent) => void,
    signal: AbortSignal,
  ): Promise<void> {
    let retryMs = 500;
    while (!signal.aborted) {
      try {
        await this.streamOnce(sessionId, onEvent, signal);
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
    onEvent: (event: ServerEvent) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/api/events?sessionId=${encodeURIComponent(sessionId)}`,
      { headers: { Authorization: `Bearer ${this.token}` }, signal },
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
        const data = frame
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data || data === "{}") continue;
        onEvent(JSON.parse(data) as ServerEvent);
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
