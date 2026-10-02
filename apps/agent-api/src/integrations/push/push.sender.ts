/**
 * Push provider contract. The message never carries sensitive data
 * (docs/08-modulos-negocio.md): amounts and references are fine, customer
 * phone numbers and names are not.
 */
export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, string | null>;
  /** Android channel; operations are high priority, the rest default. */
  channelId: 'operations' | 'security' | 'general';
}

export type PushResult = { status: 'ok'; id?: string } | { status: 'invalid_token' } | { status: 'error'; message: string };

export abstract class PushSender {
  /** One result per message, same order. Throws only if the whole call failed (network...). */
  abstract send(messages: PushMessage[]): Promise<PushResult[]>;
}

/**
 * Expo push service: routes to FCM (Android) and APNs (iOS) with the
 * credentials configured for the app in EAS. Tokens look like
 * "ExponentPushToken[...]". The provider is behind this interface, so
 * sending straight to FCM/APNs later does not change the rest.
 */
export class ExpoPushSender extends PushSender {
  constructor(
    private readonly accessToken: string | undefined,
    private readonly endpoint = 'https://exp.host/--/api/v2/push/send'
  ) {
    super();
  }

  async send(messages: PushMessage[]): Promise<PushResult[]> {
    const results: PushResult[] = [];
    for (let i = 0; i < messages.length; i += 100) {
      const batch = messages.slice(i, i + 100);
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {})
        },
        body: JSON.stringify(batch.map((m) => ({ to: m.to, title: m.title, body: m.body, data: m.data, channelId: m.channelId, sound: 'default', priority: 'high' }))),
        signal: AbortSignal.timeout(10_000)
      });
      if (!res.ok) throw new Error(`Expo push HTTP ${res.status}`);
      const json = (await res.json()) as { data?: { status: string; id?: string; message?: string; details?: { error?: string } }[] };
      batch.forEach((_, j) => {
        const r = json.data?.[j];
        if (r?.status === 'ok') results.push({ status: 'ok', id: r.id });
        else if (r?.details?.error === 'DeviceNotRegistered') results.push({ status: 'invalid_token' });
        else results.push({ status: 'error', message: r?.details?.error ?? r?.message ?? 'unknown' });
      });
    }
    return results;
  }
}

/** Development and tests: records messages; can be told to fail. */
export class InMemoryPushSender extends PushSender {
  readonly sent: PushMessage[] = [];
  /** Tokens that the provider reports as no longer registered. */
  readonly invalidTokens = new Set<string>();
  /** Number of upcoming calls that fail as a whole (provider down). */
  failCalls = 0;

  async send(messages: PushMessage[]): Promise<PushResult[]> {
    if (this.failCalls > 0) {
      this.failCalls--;
      throw new Error('push provider unavailable');
    }
    return messages.map((m) => {
      if (this.invalidTokens.has(m.to)) return { status: 'invalid_token' as const };
      this.sent.push(m);
      return { status: 'ok' as const, id: `mem_${this.sent.length}` };
    });
  }
}
