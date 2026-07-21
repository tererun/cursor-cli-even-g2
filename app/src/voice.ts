const SAMPLE_RATE = 16_000;
const SILENCE_MS = 1_000;
const NO_SPEECH_MS = 5_000;
const MAX_RECORDING_MS = 20_000;
const VOICE_RMS = 650;

export class VoiceRecorder {
  private chunks: Uint8Array[] = [];
  private startedAt = 0;
  private lastVoiceAt = 0;
  private heardVoice = false;
  private timer?: number;
  private onComplete?: (wav: Blob | null) => void;

  start(onComplete: (wav: Blob | null) => void): void {
    this.chunks = [];
    this.startedAt = performance.now();
    this.lastVoiceAt = this.startedAt;
    this.heardVoice = false;
    this.onComplete = onComplete;
    this.timer = window.setInterval(() => this.checkTimeout(), 100);
  }

  push(pcm: Uint8Array): void {
    if (!this.onComplete || pcm.byteLength === 0) return;
    this.chunks.push(pcm.slice());
    if (rms(pcm) >= VOICE_RMS) {
      this.heardVoice = true;
      this.lastVoiceAt = performance.now();
    }
  }

  finish(): void {
    if (!this.onComplete) return;
    const pcm = concat(this.chunks);
    this.complete(this.heardVoice && pcm.byteLength > 0 ? pcmToWav(pcm) : null);
  }

  cancel(): void {
    this.complete(null);
  }

  get active(): boolean {
    return Boolean(this.onComplete);
  }

  private checkTimeout(): void {
    const now = performance.now();
    if (this.heardVoice && now - this.lastVoiceAt >= SILENCE_MS) this.finish();
    else if (!this.heardVoice && now - this.startedAt >= NO_SPEECH_MS) this.finish();
    else if (now - this.startedAt >= MAX_RECORDING_MS) this.finish();
  }

  private complete(wav: Blob | null): void {
    if (this.timer) window.clearInterval(this.timer);
    const callback = this.onComplete;
    this.onComplete = undefined;
    this.timer = undefined;
    callback?.(wav);
  }
}

function rms(pcm: Uint8Array): number {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let sum = 0;
  const samples = Math.floor(pcm.byteLength / 2);
  for (let offset = 0; offset + 1 < pcm.byteLength; offset += 2) {
    const value = view.getInt16(offset, true);
    sum += value * value;
  }
  return samples ? Math.sqrt(sum / samples) : 0;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function pcmToWav(pcm: Uint8Array): Blob {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const write = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + pcm.byteLength, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, pcm.byteLength, true);
  const audio = new Uint8Array(pcm.byteLength);
  audio.set(pcm);
  return new Blob([header, audio.buffer], { type: "audio/wav" });
}
