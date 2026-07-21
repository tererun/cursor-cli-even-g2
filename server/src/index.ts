import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import { EventBus } from "./event-bus.js";
import { SessionManager } from "./session-manager.js";
import { transcribeWav } from "./stt.js";

const events = new EventBus();
const sessions = new SessionManager(events);

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

export function createApp(): Hono {
  const app = new Hono();
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.use("*", async (c, next) => {
    const origin = c.req.header("origin");
    if (origin && (allowedOrigins.includes(origin) || allowedOrigins.includes("*"))) {
      c.header("Access-Control-Allow-Origin", origin);
      c.header("Vary", "Origin");
      c.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
      c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    }
    if (c.req.method === "OPTIONS") return c.body(null, 204);
    await next();
  });

  app.use("/api/*", async (c, next) => {
    const token = process.env.BRIDGE_TOKEN;
    if (!token) return c.json({ error: "BRIDGE_TOKEN is not configured" }, 503);
    if (c.req.header("authorization") !== `Bearer ${token}`) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    await next();
  });
  app.use("/api/transcribe", bodyLimit({
    maxSize: 8 * 1024 * 1024,
    onError: (c) => c.json({ error: "Audio payload is too large" }, 413),
  }));
  const jsonBodyLimit = bodyLimit({
    maxSize: 128 * 1024,
    onError: (c) => c.json({ error: "Request body is too large" }, 413),
  });
  for (const path of [
    "/api/sessions",
    "/api/prompt",
    "/api/interrupt",
    "/api/permission-response",
    "/api/question-response",
    "/api/plan-response",
  ]) {
    app.use(path, jsonBodyLimit);
  }

  app.get("/health", (c) => c.json({ ok: true }));
  app.get("/api/info", (c) => c.json({
    provider: "cursor-acp",
    voiceEnabled: Boolean(process.env.STT_API_KEY),
  }));

  app.get("/api/sessions", (c) => c.json({ sessions: sessions.list() }));
  app.post("/api/sessions", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    return c.json(await sessions.create(requireString(body.cwd, "cwd")), 201);
  });

  app.post("/api/prompt", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const sessionId = requireString(body.sessionId, "sessionId");
    const text = requireString(body.text, "text");
    void sessions.prompt(sessionId, text).catch((error) => {
      console.error(`[session:${sessionId}]`, error);
    });
    return c.json({ accepted: true }, 202);
  });

  app.post("/api/interrupt", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    await sessions.cancel(requireString(body.sessionId, "sessionId"));
    return c.json({ ok: true });
  });

  app.post("/api/permission-response", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const decision = requireString(body.decision, "decision");
    if (!["allow-once", "allow-always", "reject-once"].includes(decision)) {
      throw new Error("Invalid permission decision");
    }
    await sessions.respond(
      requireString(body.sessionId, "sessionId"),
      requireString(body.requestId, "requestId"),
      { outcome: { outcome: "selected", optionId: decision } },
    );
    return c.json({ ok: true });
  });

  app.post("/api/question-response", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const answers = Array.isArray(body.answers) ? body.answers : [];
    await sessions.respond(
      requireString(body.sessionId, "sessionId"),
      requireString(body.requestId, "requestId"),
      answers.length
        ? { outcome: { outcome: "answered", answers } }
        : { outcome: { outcome: "skipped" } },
    );
    return c.json({ ok: true });
  });

  app.post("/api/plan-response", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    await sessions.respond(
      requireString(body.sessionId, "sessionId"),
      requireString(body.requestId, "requestId"),
      body.accepted
        ? { outcome: { outcome: "accepted" } }
        : { outcome: { outcome: "rejected", reason: body.reason } },
    );
    return c.json({ ok: true });
  });

  app.post("/api/transcribe", async (c) => {
    const wav = await c.req.arrayBuffer();
    if (wav.byteLength > 8 * 1024 * 1024) throw new Error("Audio payload is too large");
    const text = await transcribeWav(wav, c.req.query("language"));
    return c.json({ text });
  });

  app.get("/api/events", (c) => {
    const sessionId = requireString(c.req.query("sessionId"), "sessionId");
    const afterId = Number(c.req.header("last-event-id") || 0);
    return streamSSE(c, async (stream) => {
      await new Promise<void>((resolve) => {
        let writes = Promise.resolve();
        const write = (message: Parameters<typeof stream.writeSSE>[0]) => {
          writes = writes.then(() => stream.writeSSE(message));
          return writes;
        };
        void write({ event: "connected", data: JSON.stringify({ sessionId }) });
        const unsubscribe = events.subscribe(sessionId, ({ id, event }) => {
          void write({
            id: String(id),
            event: event.type,
            data: JSON.stringify(event),
          }).catch(() => {});
        }, Number.isFinite(afterId) ? afterId : 0);
        const heartbeat = setInterval(() => {
          void write({ event: "ping", data: "{}" }).catch(() => {});
        }, 15_000);
        stream.onAbort(() => {
          clearInterval(heartbeat);
          unsubscribe();
          resolve();
        });
      });
    });
  });

  app.onError((error, c) => {
    console.error(error);
    const status = error.message.includes("not found") ? 404 : 400;
    return c.json({ error: error.message }, status);
  });
  return app;
}

await sessions.initialize();

const port = Number(process.env.PORT || 3456);
const server = serve({ fetch: createApp().fetch, port, hostname: process.env.HOST || "0.0.0.0" });
console.log(`Cursor G2 bridge listening on http://${process.env.HOST || "0.0.0.0"}:${port}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    sessions.close();
    server.close(() => process.exit(0));
  });
}
