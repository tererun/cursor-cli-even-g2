import {
  AudioInputSource,
  OsEventTypeList,
  waitForEvenAppBridge,
  type EvenAppBridge,
  type EvenHubEvent,
} from "@evenrealities/even_hub_sdk";
import { ApiClient, type ServerEvent, type Session } from "./api";
import { GlassesRenderer, paginate } from "./glasses";
import { VoiceRecorder } from "./voice";
import "./style.css";

type Mode = "setup" | "sessions" | "chat" | "choice";

const elements = {
  status: document.querySelector<HTMLParagraphElement>("#status")!,
  settings: document.querySelector<HTMLFormElement>("#settings-form")!,
  sessionForm: document.querySelector<HTMLFormElement>("#session-form")!,
  serverUrl: document.querySelector<HTMLInputElement>("#server-url")!,
  token: document.querySelector<HTMLInputElement>("#token")!,
  cwd: document.querySelector<HTMLInputElement>("#cwd")!,
  sessions: document.querySelector<HTMLDivElement>("#sessions")!,
  output: document.querySelector<HTMLPreElement>("#output")!,
};

let bridge: EvenAppBridge;
let renderer: GlassesRenderer;
let api: ApiClient | undefined;
let mode: Mode = "setup";
let sessionItems: Session[] = [];
let currentSession: Session | undefined;
let streamController: AbortController | undefined;
let transcript = "";
let pages = [""];
let page = 0;
let activity = "IDLE";
let choiceHandler: ((index: number) => Promise<void>) | undefined;
const recorder = new VoiceRecorder();

function setStatus(message: string, error = false): void {
  elements.status.textContent = message;
  elements.status.classList.toggle("error", error);
}

async function loadSettings(): Promise<void> {
  const serverUrl = await bridge.getLocalStorage("cursor-g2-server").catch(() => "");
  const token = await bridge.getLocalStorage("cursor-g2-token").catch(() => "");
  elements.serverUrl.value = serverUrl || "";
  elements.token.value = token || "";
  if (serverUrl && token) await connect(serverUrl, token);
  else setStatus("Bridge URLとtokenをスマホで設定してください");
}

async function connect(serverUrl: string, token: string): Promise<void> {
  const normalizedUrl = serverUrl.replace(/\/+$/, "");
  api = new ApiClient(normalizedUrl, token);
  setStatus("接続中…");
  try {
    sessionItems = await api.listSessions();
    await bridge.setLocalStorage("cursor-g2-server", normalizedUrl);
    await bridge.setLocalStorage("cursor-g2-token", token);
    mode = "sessions";
    setStatus("接続済み。G2でセッションを選択してください");
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
    button.textContent = `${session.cwd}\n${new Date(session.updatedAt).toLocaleString()}`;
    button.addEventListener("click", () => void selectSession(session));
    elements.sessions.append(button);
  }
}

async function selectSession(session: Session): Promise<void> {
  if (!api) return;
  streamController?.abort();
  currentSession = session;
  transcript = "";
  pages = [""];
  page = 0;
  mode = "chat";
  activity = "IDLE";
  streamController = new AbortController();
  void api.stream(session.id, handleServerEvent, streamController.signal);
  setStatus(`Session: ${session.cwd}`);
  await renderChat(true);
  await startVoice();
}

function handleServerEvent(event: ServerEvent): void {
  if (event.type === "text_delta") {
    transcript += String(event.text || "");
    pages = paginate(transcript);
    page = pages.length - 1;
    elements.output.textContent = transcript;
    void renderChat();
  } else if (event.type === "status") {
    activity = String(event.state || "idle").toUpperCase();
    void renderChat();
  } else if (event.type === "permission_request") {
    const request = event.request as { toolCall?: { title?: string }; options?: Array<{ optionId: string; name?: string }> };
    const options = request.options?.map((option) => option.optionId) || [
      "allow-once",
      "allow-always",
      "reject-once",
    ];
    void showChoices(request.toolCall?.title || "ツール実行を許可しますか？", options, async (index) => {
      await api?.permission(event.sessionId, String(event.requestId), options[index] || "reject-once");
    });
  } else if (event.type === "user_question") {
    const request = event.request as {
      title?: string;
      questions?: Array<{ id: string; prompt: string; options: Array<{ id: string; label: string }> }>;
    };
    const question = request.questions?.[0];
    if (!question) return;
    void showChoices(question.prompt || request.title || "選択してください", question.options.map((item) => item.label), async (index) => {
      const selected = question.options[index];
      await api?.answer(event.sessionId, String(event.requestId), selected
        ? [{ questionId: question.id, selectedOptionIds: [selected.id] }]
        : []);
    });
  } else if (event.type === "plan_request") {
    const request = event.request as { name?: string; overview?: string };
    void showChoices(request.name || request.overview || "プランを承認しますか？", ["承認", "拒否"], async (index) => {
      await api?.approvePlan(event.sessionId, String(event.requestId), index === 0);
    });
  } else if (event.type === "error") {
    activity = "ERROR";
    setStatus(String(event.message || "Cursor error"), true);
    void renderChat();
  }
}

async function showChoices(
  title: string,
  choices: string[],
  handler: (index: number) => Promise<void>,
): Promise<void> {
  if (recorder.active) recorder.cancel();
  await bridge.audioControl(false);
  mode = "choice";
  choiceHandler = async (index) => {
    try {
      await handler(index);
    } finally {
      choiceHandler = undefined;
      mode = "chat";
      await renderChat(true);
    }
  };
  await renderer.choices(title, choices);
}

async function startVoice(): Promise<void> {
  if (!api || !currentSession || recorder.active || mode !== "chat") return;
  activity = "LISTENING";
  await renderChat();
  recorder.start((wav) => void completeVoice(wav));
  const opened = await bridge.audioControl(true, AudioInputSource.Glasses);
  if (!opened) {
    recorder.cancel();
    activity = "MIC ERROR";
    await renderChat();
  }
}

async function completeVoice(wav: Blob | null): Promise<void> {
  await bridge.audioControl(false);
  if (!wav || !api || !currentSession) {
    activity = "IDLE";
    await renderChat();
    return;
  }
  activity = "TRANSCRIBING";
  await renderChat();
  try {
    const text = await api.transcribe(wav);
    transcript += `${transcript ? "\n\n" : ""}> ${text}\n`;
    pages = paginate(transcript);
    page = pages.length - 1;
    elements.output.textContent = transcript;
    activity = "SENDING";
    await renderChat();
    await api.prompt(currentSession.id, text);
  } catch (error) {
    activity = "ERROR";
    setStatus(error instanceof Error ? error.message : String(error), true);
    await renderChat();
  }
}

async function renderChat(rebuild = false): Promise<void> {
  if (mode !== "chat") return;
  page = Math.max(0, Math.min(page, pages.length - 1));
  if (rebuild) await renderer.chat(pages[page] || "", page, pages.length, activity);
  else await renderer.updateChat(pages[page] || "", page, pages.length, activity);
}

async function handleHubEvent(event: EvenHubEvent): Promise<void> {
  if (event.audioEvent) {
    recorder.push(event.audioEvent.audioPcm);
    return;
  }
  const type = event.listEvent?.eventType ?? event.textEvent?.eventType ?? event.sysEvent?.eventType;
  if (type === OsEventTypeList.DOUBLE_CLICK_EVENT) {
    streamController?.abort();
    recorder.cancel();
    await bridge.audioControl(false);
    await bridge.shutDownPageContainer(1);
    return;
  }
  if (mode === "sessions" && event.listEvent && type === OsEventTypeList.CLICK_EVENT) {
    const selected = sessionItems[event.listEvent.currentSelectItemIndex ?? -1];
    if (selected) await selectSession(selected);
    return;
  }
  if (mode === "choice" && event.listEvent && type === OsEventTypeList.CLICK_EVENT) {
    await choiceHandler?.(event.listEvent.currentSelectItemIndex ?? -1);
    return;
  }
  if (mode !== "chat") return;
  if (type === OsEventTypeList.SCROLL_TOP_EVENT) {
    page = Math.max(0, page - 1);
    await renderChat();
  } else if (type === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
    page = Math.min(pages.length - 1, page + 1);
    await renderChat();
  } else if (type === OsEventTypeList.CLICK_EVENT) {
    if (recorder.active) recorder.finish();
    else if (activity === "BUSY" && currentSession) await api?.interrupt(currentSession.id);
    else await startVoice();
  }
}

elements.settings.addEventListener("submit", (event) => {
  event.preventDefault();
  void connect(elements.serverUrl.value.trim(), elements.token.value).catch(() => {});
});

elements.sessionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!api) return;
  void (async () => {
    const session = await api!.createSession(elements.cwd.value.trim());
    sessionItems = [session, ...sessionItems.filter((item) => item.id !== session.id)];
    renderSessionButtons();
    await renderer.sessions(sessionItems);
    await selectSession(session);
  })().catch((error) => setStatus(error instanceof Error ? error.message : String(error), true));
});

bridge = await waitForEvenAppBridge();
renderer = new GlassesRenderer(bridge);
bridge.onEvenHubEvent((event) => void handleHubEvent(event));
await renderer.initialize();
await loadSettings();
