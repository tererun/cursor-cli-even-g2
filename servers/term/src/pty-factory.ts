import { spawn } from "node-pty";
import type { PtyFactory } from "./types.js";

export const defaultPtyFactory: PtyFactory = ({ file, args, cwd, cols, rows, env }) => {
  const pty = spawn(file, args, {
    name: "xterm-256color",
    cols,
    rows,
    cwd,
    env,
  });
  return {
    write(data) {
      pty.write(data);
    },
    resize(nextCols, nextRows) {
      pty.resize(nextCols, nextRows);
    },
    onData(listener) {
      pty.onData(listener);
    },
    onExit(listener) {
      pty.onExit(listener);
    },
    kill() {
      pty.kill();
    },
  };
};
