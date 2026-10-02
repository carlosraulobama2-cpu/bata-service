import { classifyQr } from '../utils/qr';

describe('scanned QR', () => {
  // The same JSON the Velynt app shows (backend/routers/topups.py, agents_core.cashout_qr_payload).
  const topup = JSON.stringify({ schema: 'equatoriana.qr.topup', version: 1, topup_request_id: '0b8e2c1a-5f7d-4e3b-9a1c-2d3e4f5a6b7c' });
  const cashout = JSON.stringify({ schema: 'equatoriana.qr.cashout', version: 1, cashout_request_id: '0b8e2c1a-5f7d-4e3b-9a1c-2d3e4f5a6b7c', code: '482913' });

  it('routes top-up and withdrawal codes by their schema', () => {
    expect(classifyQr(topup)).toBe('topup');
    expect(classifyQr(`  ${cashout}\n`)).toBe('cashout');
  });

  it('recognises other Velynt codes the agent cannot use', () => {
    expect(classifyQr(JSON.stringify({ schema: 'equatoriana.qr.personal', version: 2, t: 'abc' }))).toBe('other_velynt');
    expect(classifyQr(JSON.stringify({ schema: 'equatoriana.qr.payment' }))).toBe('other_velynt');
  });

  it('rejects anything else', () => {
    expect(classifyQr('https://example.com')).toBe('unknown');
    expect(classifyQr('BSV1.W.wdr_123456')).toBe('unknown');
    expect(classifyQr('{"schema":"other.app"}')).toBe('unknown');
    expect(classifyQr('null')).toBe('unknown');
    expect(classifyQr('{"schema":"toString"}')).toBe('unknown');
  });
});
