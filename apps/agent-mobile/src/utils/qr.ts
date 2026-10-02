import qrcode from 'qrcode-generator';

/**
 * What a scanned Velynt QR is, read from its `schema` (JSON made by the Velynt app). The app only
 * routes by it; the agents API decides whether the code is valid, unused and not expired.
 * - topup: the customer's top-up request -> deposit of that amount
 * - cashout: the customer's withdrawal (carries its one-time code) -> withdrawal
 * - personal / request / payment: other Velynt QRs the agents app cannot use
 */
export type ScannedQr = 'topup' | 'cashout' | 'other_velynt' | 'unknown';

const SCHEMAS = new Map<string, ScannedQr>([
  ['equatoriana.qr.topup', 'topup'],
  ['equatoriana.qr.cashout', 'cashout'],
  ['equatoriana.qr.personal', 'other_velynt'],
  ['equatoriana.qr.request', 'other_velynt'],
  ['equatoriana.qr.payment', 'other_velynt']
]);

export function classifyQr(data: string): ScannedQr {
  try {
    const parsed: unknown = JSON.parse(data.trim());
    const schema = parsed && typeof parsed === 'object' ? (parsed as { schema?: unknown }).schema : undefined;
    return (typeof schema === 'string' && SCHEMAS.get(schema)) || 'unknown';
  } catch {
    return 'unknown';
  }
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
