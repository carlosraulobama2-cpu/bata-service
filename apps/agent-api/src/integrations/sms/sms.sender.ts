import { Logger } from '@nestjs/common';

/** SMS provider contract (provider por confirmar). */
export abstract class SmsSender {
  abstract send(phoneE164: string, message: string): Promise<void>;
}

/**
 * Development/test sender: keeps messages in memory so tests can read the
 * OTP. In development it also logs a masked notice (never the code).
 */
export class InMemorySmsSender extends SmsSender {
  private readonly logger = new Logger('InMemorySmsSender');
  readonly sent: { to: string; message: string }[] = [];

  async send(to: string, message: string): Promise<void> {
    this.sent.push({ to, message });
    this.logger.log(`SMS queued to ****${to.slice(-4)} (in-memory sender, not delivered)`);
  }

  lastCodeFor(phone: string): string | null {
    const msg = [...this.sent].reverse().find((m) => m.to === phone);
    return msg ? (/(\d{6})/.exec(msg.message)?.[1] ?? null) : null;
  }
}
