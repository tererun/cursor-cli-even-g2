import { encodeKey, shouldPreventDefault, type KeyStroke } from "./keys";

interface VirtualKeyboardNavigator extends Navigator {
  virtualKeyboard?: { show?: () => void };
}

export class KeyboardCapture {
  private composing = false;
  private focused = false;
  private armed = false;
  private flushTimer: number | undefined;
  private pending = "";
  private onData?: (data: string) => void;
  private retryTimer: number | undefined;

  constructor(private readonly field: HTMLTextAreaElement) {}

  start(onData: (data: string) => void): void {
    this.onData = onData;
    this.field.addEventListener("keydown", this.onKeyDown);
    this.field.addEventListener("compositionstart", this.onCompositionStart);
    this.field.addEventListener("compositionend", this.onCompositionEnd);
    this.field.addEventListener("blur", this.onBlur);
    this.field.addEventListener("focus", this.onFocus);
    document.addEventListener("visibilitychange", this.onVisibility);
    window.addEventListener("focus", this.onWindowFocus);
  }

  arm(): void {
    this.armed = true;
    this.keepFocus();
  }

  disarm(): void {
    this.armed = false;
    if (this.retryTimer) window.clearInterval(this.retryTimer);
    this.retryTimer = undefined;
  }

  stop(): void {
    this.onData = undefined;
    this.field.removeEventListener("keydown", this.onKeyDown);
    this.field.removeEventListener("compositionstart", this.onCompositionStart);
    this.field.removeEventListener("compositionend", this.onCompositionEnd);
    this.field.removeEventListener("blur", this.onBlur);
    this.field.removeEventListener("focus", this.onFocus);
    document.removeEventListener("visibilitychange", this.onVisibility);
    window.removeEventListener("focus", this.onWindowFocus);
    if (this.retryTimer) window.clearInterval(this.retryTimer);
    if (this.flushTimer) window.clearTimeout(this.flushTimer);
  }

  get isFocused(): boolean {
    return this.focused && document.activeElement === this.field;
  }

  keepFocus(): void {
    this.armed = true;
    this.focusNow();
    window.requestAnimationFrame(() => this.focusNow());
    if (this.retryTimer) window.clearInterval(this.retryTimer);
    const startedAt = Date.now();
    this.retryTimer = window.setInterval(() => {
      if (Date.now() - startedAt > 8_000) {
        if (this.retryTimer) window.clearInterval(this.retryTimer);
        this.retryTimer = undefined;
        return;
      }
      this.focusNow();
    }, 400);
  }

  private focusNow(): void {
    this.field.focus({ preventScroll: true });
    try {
      (navigator as VirtualKeyboardNavigator).virtualKeyboard?.show?.();
    } catch {
      // Hardware BT keyboards do not need the software keyboard.
    }
    this.focused = document.activeElement === this.field;
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const stroke: KeyStroke = {
      key: event.key,
      code: event.code,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      isComposing: event.isComposing || this.composing,
    };
    if (shouldPreventDefault(stroke)) event.preventDefault();
    const encoded = encodeKey(stroke);
    if (!encoded) return;
    this.queue(encoded, event.key === "Escape" || event.ctrlKey);
    this.field.value = "";
  };

  private readonly onCompositionStart = (): void => {
    this.composing = true;
  };

  private readonly onCompositionEnd = (event: CompositionEvent): void => {
    this.composing = false;
    if (event.data) this.queue(event.data, true);
    this.field.value = "";
  };

  private readonly onBlur = (): void => {
    this.focused = false;
    window.setTimeout(() => {
      if (this.armed && document.visibilityState === "visible") this.focusNow();
    }, 50);
  };

  private readonly onFocus = (): void => {
    this.focused = true;
  };

  private readonly onVisibility = (): void => {
    if (this.armed && document.visibilityState === "visible") this.keepFocus();
  };

  private readonly onWindowFocus = (): void => {
    if (this.armed) this.keepFocus();
  };

  private queue(data: string, immediate: boolean): void {
    this.pending += data;
    if (immediate) {
      this.flush();
      return;
    }
    if (this.flushTimer) return;
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = undefined;
      this.flush();
    }, 16);
  }

  private flush(): void {
    if (this.flushTimer) {
      window.clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    const data = this.pending;
    this.pending = "";
    if (data) this.onData?.(data);
  }
}
