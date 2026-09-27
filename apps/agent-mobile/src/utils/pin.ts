/**
 * Same rules as the server (apps/agent-api common/crypto/secrets.ts), only
 * to guide the agent before sending: 6 digits, not all equal, not a
 * straight sequence. The server decides.
 */
export function isAcceptablePin(pin: string): boolean {
  if (!/^\d{6}$/.test(pin)) return false;
  if (/^(\d)\1{5}$/.test(pin)) return false;
  return !'0123456789012345'.includes(pin) && !'9876543210987654'.includes(pin);
}
