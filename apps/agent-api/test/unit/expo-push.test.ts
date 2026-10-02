import { createServer, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ExpoPushSender, PushMessage } from '../../src/integrations/push/push.sender';

describe('ExpoPushSender', () => {
  let server: Server;
  let url: string;
  const calls: { auth?: string; body: any[] }[] = [];
  let status = 200;

  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const body = JSON.parse(raw);
        calls.push({ auth: req.headers.authorization, body });
        res.statusCode = status;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            data: body.map((m: any) =>
              m.to.includes('gone') ? { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } } : m.to.includes('bad') ? { status: 'error', message: 'MessageRateExceeded', details: { error: 'MessageRateExceeded' } } : { status: 'ok', id: `tk_${m.to}` }
            )
          })
        );
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/send`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const msg = (to: string): PushMessage => ({ to, title: 'Retiro completado', body: 'Entregaste 50.000 XAF', channelId: 'operations', data: { type: 'cash_out_completed', transaction_id: 't1' } });

  it('maps each result and sends the access token', async () => {
    const results = await new ExpoPushSender('secret-token', url).send([msg('ok1'), msg('gone1'), msg('bad1')]);
    expect(results).toEqual([{ status: 'ok', id: 'tk_ok1' }, { status: 'invalid_token' }, { status: 'error', message: 'MessageRateExceeded' }]);
    expect(calls[0]!.auth).toBe('Bearer secret-token');
    expect(calls[0]!.body[0]).toMatchObject({ to: 'ok1', title: 'Retiro completado', channelId: 'operations', priority: 'high', data: { transaction_id: 't1' } });
  });

  it('sends in batches of 100', async () => {
    calls.length = 0;
    const results = await new ExpoPushSender(undefined, url).send(Array.from({ length: 230 }, (_, i) => msg(`ok${i}`)));
    expect(results).toHaveLength(230);
    expect(calls.map((c) => c.body.length)).toEqual([100, 100, 30]);
    expect(calls[0]!.auth).toBeUndefined();
  });

  it('throws when the provider fails as a whole (the dispatcher retries)', async () => {
    status = 503;
    await expect(new ExpoPushSender(undefined, url).send([msg('ok')])).rejects.toThrow('HTTP 503');
    status = 200;
  });
});
