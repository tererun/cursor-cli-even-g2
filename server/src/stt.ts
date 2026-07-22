export async function transcribeWav(
  wav: ArrayBuffer,
  language?: string,
): Promise<string> {
  const apiKey = process.env.STT_API_KEY;
  if (!apiKey) {
    throw new Error("Voice input is disabled: STT_API_KEY is not configured");
  }

  const endpoint = process.env.STT_ENDPOINT || "https://api.openai.com/v1/audio/transcriptions";
  const form = new FormData();
  form.append("file", new Blob([wav], { type: "audio/wav" }), "prompt.wav");
  form.append("model", process.env.STT_MODEL || "whisper-1");
  if (language) form.append("language", language);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`STT provider returned ${response.status}: ${detail.slice(0, 300)}`);
  }
  const result = await response.json() as { text?: string };
  if (!result.text?.trim()) throw new Error("STT provider returned an empty transcript");
  return result.text.trim();
}
