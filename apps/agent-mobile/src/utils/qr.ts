import qrcode from 'qrcode-generator';

/** Our QR format (docs/05-api.md §9). The app only checks the shape; the server decides validity. */
const PAYLOAD = /^BSV1\.[AKCW]\.[A-Za-z0-9_-]{4,100}(?:\.[A-Za-z0-9_-]{20,200})?$/;

export function looksLikeBataQr(data: string): boolean {
  return PAYLOAD.test(data.trim());
}

/**
 * SVG path of the dark modules of a QR code (one 1×1 square per module),
 * plus the module count so the caller can scale it. Error correction M:
 * readable on cracked or dim screens without growing the code too much.
 */
export function qrPath(data: string): { size: number; path: string } {
  const qr = qrcode(0, 'M');
  qr.addData(data, 'Byte');
  qr.make();
  const size = qr.getModuleCount();
  let path = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (qr.isDark(r, c)) path += `M${c} ${r}h1v1h-1z`;
    }
  }
  return { size, path };
}
