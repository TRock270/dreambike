// Re-encoding images in the browser with a canvas (nothing is uploaded). Shared by the before/after
// download in BeforeAfter and by the estimate PDF export (pdfExport.ts).
import { MOCK_LABEL } from "../mocks";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Demo results are visibly labeled (CLAUDE.md): a mock file carries the label in its pixels, not only its name. */
export function drawMockLabel(ctx: Ctx, width: number) {
  const size = Math.max(16, Math.round(width / 60));
  ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
  ctx.fillRect(0, 0, width, size * 2);
  ctx.fillStyle = "white";
  ctx.font = `${size}px sans-serif`;
  ctx.textBaseline = "middle";
  ctx.fillText(`MOCK: ${MOCK_LABEL}`, size / 2, size);
}

type Encoding = "image/jpeg" | "image/png";

/** JPEG has no alpha: transparent pixels would turn black, so a JPEG gets a white ground first. PNG keeps its alpha. */
function whiteUnderJpeg(ctx: Ctx, type: Encoding, width: number, height: number) {
  if (type !== "image/jpeg") return;
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, width, height);
}

/** Draw the blob on a canvas (with the mock band when asked) and encode it. Quality only applies to JPEG. */
async function encode(blob: Blob, type: Encoding, mock: boolean): Promise<Blob> {
  const quality = type === "image/jpeg" ? 0.92 : undefined;
  const bitmap = await createImageBitmap(blob);
  try {
    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no canvas");
      whiteUnderJpeg(ctx, type, bitmap.width, bitmap.height);
      ctx.drawImage(bitmap, 0, 0);
      if (mock) drawMockLabel(ctx, bitmap.width);
      return await canvas.convertToBlob({ type, quality });
    }
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    whiteUnderJpeg(ctx, type, bitmap.width, bitmap.height);
    ctx.drawImage(bitmap, 0, 0);
    if (mock) drawMockLabel(ctx, bitmap.width);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), type, quality));
  } finally {
    bitmap.close();
  }
}

/** Re-encode the blob as JPEG on this device. Nothing is uploaded. */
export async function toJpeg(blob: Blob, mock: boolean): Promise<Blob> {
  return encode(blob, "image/jpeg", mock);
}

/** Re-encode the blob as PNG on this device (keeps transparency; used for a WebP shop logo). */
export async function toPng(blob: Blob): Promise<Blob> {
  return encode(blob, "image/png", false);
}
