import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import { EventBus } from "./event-bus.js";
import { SessionManager } from "./session-manager.js";
import type { CreateSessionInput } from "./types.js";

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
      c.header("Access-Control-Allow-Headers", "Authorization, Content-Type, Last-Event-ID");
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

  const jsonBodyLimit = bodyLimit({
    maxSize: 32 * 1024,
    onError: (c) => c.json({ error: "Request body is too large" }, 413),
  });
  for (const path of ["/api/sessions", "/api/input", "/api/resize", "/api/close"]) {
    app.use(path, jsonBodyLimit);
  }

  app.get("/health", (c) => c.json({ ok: true, product: "g2-term" }));
  app.get("/api/info", (c) => c.json({
    provider: "g2-term",
    defaultCols: Number(process.env.DEFAULT_COLS || 38),
    defaultRows: Number(process.env.DEFAULT_ROWS || 12),
  }));

  app.get("/api/sessions", (c) => c.json({ sessions: sessions.list() }));
  app.post("/api/sessions", async (c) => {
    const body = await c.req.json<CreateSessionInput>();
    return c.json(await sessions.create(body), 201);
  });

  app.post("/api/input", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    sessions.write(requireString(body.sessionId, "sessionId"), requireString(body.data, "data"));
    return c.json({ ok: true });
  });

  app.post("/api/resize", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    sessions.resize(
      requireString(body.sessionId, "sessionId"),
      Number(body.cols),
      Number(body.rows),
    );
    return c.json({ ok: true });
  });

  app.post("/api/close", async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    sessions.close(requireString(body.sessionId, "sessionId"));
    return c.json({ ok: true });
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
        try {
          const snapshot = sessions.get(sessionId).snapshot();
          void write({
            event: "frame",
            data: JSON.stringify({
              type: "frame",
              sessionId,
              ...snapshot,
              seq: 0,
            }),
          });
        } catch {
          // session may have already exited; replay + live events still attach
        }
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

const port = Number(process.env.PORT || 3457);
const server = serve({ fetch: createApp().fetch, port, hostname: process.env.HOST || "0.0.0.0" });
console.log(`G2 term bridge listening on http://${process.env.HOST || "0.0.0.0"}:${port}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    sessions.closeAll();
    server.close(() => process.exit(0));
  });
}
