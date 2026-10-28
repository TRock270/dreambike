// Server-sent events from a fetch body, robust to arbitrary byte splits
// (multi-byte UTF-8 characters, CRLF/CR/LF line ends, and frames may be cut
// anywhere). Pure; tested offline. Yields each frame's JSON data payload.

export async function* sseEvents(body: ReadableStream<Uint8Array>, maxBytes = 40_000_000): AsyncGenerator<unknown> {
  const decoder = new TextDecoder("utf-8");
  const reader = body.getReader();
  let buffer = "";
  let pendingCR = false; // a chunk ended in "\r": maybe the first half of "\r\n"
  let scanFrom = 0;
  let total = 0;
  let finished = false;
  // Normalize only new text to "\n" line ends, carrying a trailing "\r".
  const append = (text: string) => {
    // A held "\r" plus a leading "\n" is one CRLF; otherwise the "\r" was a line end on its own.
    if (pendingCR) { text = text.startsWith("\n") ? text : "\n" + text; pendingCR = false; }
    if (text.endsWith("\r")) { pendingCR = true; text = text.slice(0, -1); }
    buffer += text.replace(/\r\n?/g, "\n");
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) throw new Error("SSE stream exceeded the byte bound");
        // stream: true keeps a partial UTF-8 sequence for the next chunk.
        append(decoder.decode(value, { stream: true }));
      }
      if (done) {
        append(decoder.decode());
        if (pendingCR) { buffer += "\n"; pendingCR = false; }
      }
      // Search only the new part of the buffer (minus one char for a split "\n\n").
      let end: number;
      while ((end = buffer.indexOf("\n\n", Math.max(0, scanFrom - 1))) >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        scanFrom = 0;
        const event = parseFrame(frame);
        if (event !== undefined) yield event;
      }
      scanFrom = buffer.length;
      if (done) {
        finished = true;
        const event = parseFrame(buffer);
        if (event !== undefined) yield event;
        return;
      }
    }
  } finally {
    // If the consumer stopped early, close the upstream body instead of leaving it open.
    if (!finished) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function parseFrame(frame: string): unknown {
  const data = frame.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).replace(/^ /, ""));
  if (data.length === 0) return undefined;
  const payload = data.join("\n");
  if (payload.trim() === "[DONE]") return undefined;
  return JSON.parse(payload) as unknown;
}
