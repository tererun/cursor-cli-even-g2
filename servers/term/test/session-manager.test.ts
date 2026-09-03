import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { EventBus } from "../src/event-bus.js";
import { SessionManager } from "../src/session-manager.js";
import type { PtyFactory, PtyHandle } from "../src/types.js";

const originalEnv = {
  ALLOWED_PROJECT_ROOTS: process.env.ALLOWED_PROJECT_ROOTS,
  ALLOWED_SSH_HOSTS: process.env.ALLOWED_SSH_HOSTS,
};

afterEach(() => {
  restore("ALLOWED_PROJECT_ROOTS", originalEnv.ALLOWED_PROJECT_ROOTS);
  restore("ALLOWED_SSH_HOSTS", originalEnv.ALLOWED_SSH_HOSTS);
});

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function fakePty(): { factory: PtyFactory; writes: string[] } {
  const writes: string[] = [];
  const handle: PtyHandle = {
    write(data) { writes.push(data); },
    resize() {},
    onData() {},
    onExit() {},
    kill() {},
  };
  return { factory: () => handle, writes };
}

test("rejects cwd outside the allowlist", async () => {
  const root = await mkdtemp(join(tmpdir(), "g2-term-"));
  process.env.ALLOWED_PROJECT_ROOTS = root;
  const { factory } = fakePty();
  const manager = new SessionManager(new EventBus(), factory);
  await assert.rejects(
    manager.create({ kind: "shell", cwd: tmpdir() }),
    /ALLOWED_PROJECT_ROOTS/,
  );
});

test("creates an ssh command without interpolating a shell string", async () => {
  const root = await mkdtemp(join(tmpdir(), "g2-term-"));
  process.env.ALLOWED_PROJECT_ROOTS = root;
  delete process.env.ALLOWED_SSH_HOSTS;
  const { factory, writes } = fakePty();
  const manager = new SessionManager(new EventBus(), factory);
  const session = await manager.create({
    kind: "ssh",
    cwd: root,
    ssh: { user: "ada", host: "devbox", port: 2222 },
  });
  assert.equal(session.command, "ssh -tt -p 2222 -l ada devbox");
  manager.write(session.id, "nvim\r");
  assert.deepEqual(writes, ["nvim\r"]);
});

test("rejects an ssh host outside the allowlist", async () => {
  const root = await mkdtemp(join(tmpdir(), "g2-term-"));
  process.env.ALLOWED_PROJECT_ROOTS = root;
  process.env.ALLOWED_SSH_HOSTS = "devbox";
  const { factory } = fakePty();
  const manager = new SessionManager(new EventBus(), factory);
  await assert.rejects(
    manager.create({ kind: "ssh", cwd: root, ssh: { host: "evil.example" } }),
    /ALLOWED_SSH_HOSTS/,
  );
});
