/** The Velynt payment PIN: 4 digits (the same PIN confirms payments in the customer app). */
export const PIN_LENGTH = 4;

/**
 * Same rules as the server (velynt/backend/auth.py validate_new_pin), only to guide the agent
 * before sending: 4 digits, not all equal, not a straight run up or down (1234, 4321). The server
 * decides.
 */
export function isAcceptablePin(pin: string): boolean {
  if (!new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin)) return false;
  const digits = [...pin].map(Number);
  const steps = new Set(digits.slice(1).map((d, i) => d - digits[i]!));
  if (new Set(digits).size === 1) return false;
  return !(steps.size === 1 && (steps.has(1) || steps.has(-1)));
}
