import {
  OsEventTypeList,
  waitForEvenAppBridge,
  type EvenAppBridge,
  type EvenHubEvent,
} from "@evenrealities/even_hub_sdk";
import { TermApi, type TermEvent, type TermSession } from "./api";
import { GlassesRenderer } from "./glasses";
import { KeyboardCapture } from "./keyboard";
import "./style.css";

type Mode = "setup" | "sessions" | "term";

const elements = {
  status: document.querySelector<HTMLParagraphElement>("#status")!,
  settings: document.querySelector<HTMLFormElement>("#settings-form")!,
  sessionForm: document.querySelector<HTMLFormElement>("#session-form")!,
  serverUrl: document.querySelector<HTMLInputElement>("#server-url")!,
  token: document.querySelector<HTMLInputElement>("#token")!,
  kind: document.querySelector<HTMLSelectElement>("#kind")!,
  cwd: document.querySelector<HTMLInputElement>("#cwd")!,
  sshFields: document.querySelector<HTMLDivElement>("#ssh-fields")!,
  sshUser: document.querySelector<HTMLInputElement>("#ssh-user")!,
  sshHost: document.querySelector<HTMLInputElement>("#ssh-host")!,
  sshPort: document.querySelector<HTMLInputElement>("#ssh-port")!,
  sessions: document.querySelector<HTMLDivElement>("#sessions")!,
  output: document.querySelector<HTMLPreElement>("#output")!,
  kbStatus: document.querySelector<HTMLParagraphElement>("#kb-status")!,
  kbCapture: document.querySelector<HTMLTextAreaElement>("#kb-capture")!,
  focusKb: document.querySelector<HTMLButtonElement>("#focus-kb")!,
  sendEsc: document.querySelector<HTMLButtonElement>("#send-esc")!,
  sendCtrlC: document.querySelector<HTMLButtonElement>("#send-ctrl-c")!,
  sendTab: document.querySelector<HTMLButtonElement>("#send-tab")!,
  sendCtrlZ: document.querySelector<HTMLButtonElement>("#send-ctrl-z")!,
};

let bridge: EvenAppBridge;
let renderer: GlassesRenderer;
let api: TermApi | undefined;
let mode: Mode = "setup";
let sessionItems: TermSession[] = [];
let currentSession: TermSession | undefined;
let streamController: AbortController | undefined;
let listSelection = 0;
let latestText = "";
let pageBuilt = false;
const inputQueue: string[] = [];
let sending = false;
const keyboard = new KeyboardCapture(elements.kbCapture);

function setStatus(message: string, error = false): void {
  elements.status.textContent = message;
  elements.status.classList.toggle("error", error);
}

function setKbStatus(): void {
  elements.kbStatus.textContent = keyboard.isFocused
    ? "BTキーボード入力中（この画面を前面に保つ）"
    : "未フォーカス。ボタンかG2タップで掴み直す";
}

async function loadSettings(): Promise<void> {
  const serverUrl = await bridge.getLocalStorage("g2-term-server").catch(() => "");
  const token = await bridge.getLocalStorage("g2-term-token").catch(() => "");
  const cwd = await bridge.getLocalStorage("g2-term-cwd").catch(() => "");
  const sshUser = await bridge.getLocalStorage("g2-term-ssh-user").catch(() => "");
  const sshHost = await bridge.getLocalStorage("g2-term-ssh-host").catch(() => "");
  elements.serverUrl.value = serverUrl || "";
  elements.token.value = token || "";
  elements.cwd.value = cwd || "";
  elements.sshUser.value = sshUser || "";
  elements.sshHost.value = sshHost || "";
  if (serverUrl && token) await connect(serverUrl, token);
  else setStatus("Bridge URLとtokenをスマホで設定してください");
}

async function connect(serverUrl: string, token: string): Promise<void> {
  const normalizedUrl = serverUrl.replace(/\/+$/, "");
  api = new TermApi(normalizedUrl, token);
  setStatus("接続中…");
  try {
    sessionItems = await api.listSessions();
    await bridge.setLocalStorage("g2-term-server", normalizedUrl);
    await bridge.setLocalStorage("g2-term-token", token);
    mode = "sessions";
    listSelection = 0;
    setStatus("接続済み。セッションを選ぶか新規作成");
    renderSessionButtons();
    await renderer.sessions(sessionItems);
  } catch (error) {
    mode = "setup";
    setStatus(error instanceof Error ? error.message : String(error), true);
    throw error;
  }
}

function renderSessionButtons(): void {
  elements.sessions.replaceChildren();
  for (const session of sessionItems) {
    const button = document.createElement("button");
    button.className = "session";
    button.textContent = `${session.title}\n${session.kind} ${session.cwd}`;
    button.addEventListener("click", () => void attachSession(session));
    elements.sessions.append(button);
  }
}

async function attachSession(session: TermSession): Promise<void> {
  if (!api) return;
  streamController?.abort();
  currentSession = session;
  latestText = "";
  pageBuilt = false;
  mode = "term";
  elements.output.textContent = "";
  streamController = new AbortController();
  void api.stream(session.id, handleServerEvent, streamController.signal);
  setStatus(`${session.title}  ${session.cols}x${session.rows}`);
  keyboard.keepFocus();
  setKbStatus();
  await renderer.terminal("connecting…");
}

function handleServerEvent(event: TermEvent): void {
  if (!currentSession || event.sessionId !== currentSession.id) return;
  if (event.type === "frame") {
    latestText = String(event.text || "");
    elements.output.textContent = latestText;
    void pushGlasses();
  } else if (event.type === "error") {
    setStatus(String(event.message || "term error"), true);
  } else if (event.type === "exit") {
    setStatus(`終了 code=${String(event.code ?? "")}`);
  }
}

async function pushGlasses(): Promise<void> {
  if (mode !== "term") return;
  if (!pageBuilt) {
    pageBuilt = true;
    await renderer.terminal(latestText);
    return;
  }
  await renderer.updateTerminal(latestText);
}

function enqueueInput(data: string): void {
  if (!api || !currentSession || !data) return;
  inputQueue.push(data);
  void flushInput();
}

async function flushInput(): Promise<void> {
  if (sending || !api || !currentSession) return;
  sending = true;
  try {
    while (inputQueue.length && currentSession) {
      const data = inputQueue.splice(0, 8).join("");
      await api.input(currentSession.id, data);
    }
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), true);
  } finally {
    sending = false;
    if (inputQueue.length) void flushInput();
  }
}

async function handleHubEvent(event: EvenHubEvent): Promise<void> {
  const type = event.listEvent?.eventType ?? event.textEvent?.eventType ?? event.sysEvent?.eventType;
  if (event.listEvent?.currentSelectItemIndex !== undefined) {
    listSelection = event.listEvent.currentSelectItemIndex;
  }
  const isClick = type === OsEventTypeList.CLICK_EVENT
    || (type === undefined && Boolean(event.listEvent || event.textEvent));
  if (type === OsEventTypeList.DOUBLE_CLICK_EVENT) {
    streamController?.abort();
    await bridge.shutDownPageContainer(1);
    return;
  }
  const longPress = Number((OsEventTypeList as unknown as Record<string, number>).LONG_PRESS_EVENT ?? 9);
  if (type === longPress) {
    if (mode === "term") enqueueInput("\x1b");
    return;
  }
  if (mode === "sessions" && event.listEvent && isClick) {
    const selected = sessionItems[listSelection];
    if (selected) await attachSession(selected);
    return;
  }
  if (mode !== "term") return;
  if (type === OsEventTypeList.SCROLL_TOP_EVENT) enqueueInput("\x1b[5~");
  else if (type === OsEventTypeList.SCROLL_BOTTOM_EVENT) enqueueInput("\x1b[6~");
  else if (isClick) {
    keyboard.keepFocus();
    setKbStatus();
  }
}

function toggleSshFields(): void {
  elements.sshFields.hidden = elements.kind.value !== "ssh";
}

elements.settings.addEventListener("submit", (event) => {
  event.preventDefault();
  void connect(elements.serverUrl.value.trim(), elements.token.value).catch(() => {});
});

elements.kind.addEventListener("change", toggleSshFields);

elements.sessionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!api) return;
  void (async () => {
    const kind = elements.kind.value as TermSession["kind"];
    const cwd = elements.cwd.value.trim();
    const session = await api!.createSession({
      kind,
      cwd,
      ssh: kind === "ssh"
        ? {
            user: elements.sshUser.value.trim() || undefined,
            host: elements.sshHost.value.trim(),
            port: Number(elements.sshPort.value || 22),
          }
        : undefined,
    });
    await bridge.setLocalStorage("g2-term-cwd", cwd);
    await bridge.setLocalStorage("g2-term-ssh-user", elements.sshUser.value.trim());
    await bridge.setLocalStorage("g2-term-ssh-host", elements.sshHost.value.trim());
    sessionItems = [session, ...sessionItems.filter((item) => item.id !== session.id)];
    renderSessionButtons();
    await attachSession(session);
  })().catch((error) => setStatus(error instanceof Error ? error.message : String(error), true));
});

elements.focusKb.addEventListener("click", () => {
  keyboard.keepFocus();
  setKbStatus();
});
elements.sendEsc.addEventListener("click", () => enqueueInput("\x1b"));
elements.sendCtrlC.addEventListener("click", () => enqueueInput("\x03"));
elements.sendTab.addEventListener("click", () => enqueueInput("\t"));
elements.sendCtrlZ.addEventListener("click", () => enqueueInput("\x1a"));

keyboard.start((data) => enqueueInput(data));
window.setInterval(setKbStatus, 1000);
toggleSshFields();

bridge = await waitForEvenAppBridge();
renderer = new GlassesRenderer(bridge);
bridge.onEvenHubEvent((event) => void handleHubEvent(event));
await renderer.initialize();
await loadSettings();
