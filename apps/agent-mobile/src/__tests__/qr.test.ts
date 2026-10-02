import qrcode from 'qrcode-generator';
import { looksLikeVelyntQr, qrPath } from '../utils/qr';

describe('QR helpers', () => {
  const payload = 'BSV1.K.Zx8fQ2kLm0pR7sT1uV3wYA.' + 'a'.repeat(86);

  it('recognises the VELYNT SERVICES format only by shape', () => {
    expect(looksLikeVelyntQr(payload)).toBe(true);
    expect(looksLikeVelyntQr('BSV1.W.wdr_123456')).toBe(true);
    expect(looksLikeVelyntQr('  BSV1.C.abcdEFGH_-  ')).toBe(true);
    expect(looksLikeVelyntQr('https://example.com')).toBe(false);
    expect(looksLikeVelyntQr('BSV1.X.abcdefgh')).toBe(false);
    expect(looksLikeVelyntQr('BSV2.K.abcdefgh')).toBe(false);
  });

  it('draws exactly the dark modules of the code', () => {
    const { size, path } = qrPath(payload);
    const ref = qrcode(0, 'M');
    ref.addData(payload, 'Byte');
    ref.make();
    expect(size).toBe(ref.getModuleCount());
    let dark = 0;
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (ref.isDark(r, c)) dark++;
    expect(path.match(/M/g)?.length).toBe(dark);
    // Finder pattern: top-left module is always dark.
    expect(path.startsWith('M0 0h1v1h-1z')).toBe(true);
  });
});
