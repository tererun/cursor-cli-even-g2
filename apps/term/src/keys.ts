export interface KeyStroke {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
}

const SPECIAL: Record<string, string> = {
  Enter: "\r",
  Backspace: "\x7f",
  Tab: "\t",
  Escape: "\x1b",
  ArrowUp: "\x1b[A",
  ArrowDown: "\x1b[B",
  ArrowRight: "\x1b[C",
  ArrowLeft: "\x1b[D",
  Home: "\x1b[H",
  End: "\x1b[F",
  PageUp: "\x1b[5~",
  PageDown: "\x1b[6~",
  Insert: "\x1b[2~",
  Delete: "\x1b[3~",
};

const CTRL_ARROWS: Record<string, string> = {
  ArrowUp: "\x1b[1;5A",
  ArrowDown: "\x1b[1;5B",
  ArrowRight: "\x1b[1;5C",
  ArrowLeft: "\x1b[1;5D",
  Home: "\x1b[1;5H",
  End: "\x1b[1;5F",
};

const FUNCTION_KEYS: Record<string, string> = {
  F1: "\x1bOP",
  F2: "\x1bOQ",
  F3: "\x1bOR",
  F4: "\x1bOS",
  F5: "\x1b[15~",
  F6: "\x1b[17~",
  F7: "\x1b[18~",
  F8: "\x1b[19~",
  F9: "\x1b[20~",
  F10: "\x1b[21~",
  F11: "\x1b[23~",
  F12: "\x1b[24~",
};

const IGNORED = new Set([
  "Shift",
  "Control",
  "Alt",
  "Meta",
  "CapsLock",
  "NumLock",
  "ScrollLock",
  "Process",
  "Dead",
  "Unidentified",
]);

export function encodeKey(event: KeyStroke): string | null {
  if (event.isComposing || IGNORED.has(event.key)) return null;

  if (event.ctrlKey && !event.altKey && !event.metaKey) {
    if (CTRL_ARROWS[event.key]) return CTRL_ARROWS[event.key];
    if (event.key === " ") return "\x00";
    if (event.key.length === 1) {
      const code = event.key.toUpperCase().charCodeAt(0);
      if (code >= 64 && code <= 95) return String.fromCharCode(code - 64);
    }
    const named: Record<string, string> = {
      Backspace: "\x08",
      Enter: "\n",
      "[" : "\x1b",
    };
    return named[event.key] ?? null;
  }

  if (event.altKey && !event.metaKey) {
    const base = event.ctrlKey ? encodeKey({ ...event, altKey: false, ctrlKey: true }) : encodePlain(event);
    return base ? `\x1b${base}` : null;
  }

  if (event.metaKey) return null;
  return encodePlain(event);
}

function encodePlain(event: KeyStroke): string | null {
  if (SPECIAL[event.key]) return SPECIAL[event.key];
  if (FUNCTION_KEYS[event.key]) return FUNCTION_KEYS[event.key];
  if (event.key.length === 1) return event.key;
  return null;
}

export function shouldPreventDefault(event: KeyStroke): boolean {
  if (event.isComposing) return false;
  if (event.metaKey) return false;
  return encodeKey(event) !== null;
}
