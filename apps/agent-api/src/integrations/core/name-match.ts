/**
 * Name comparison used when an agent types a customer's name.
 * Case, accents, punctuation and extra spaces are ignored. The typed name
 * must contain at least two words (first name + a surname), and every
 * typed word must be part of the registered name, so "Juan Mba" matches
 * "Juan Pablo Mba Nsue", but "Juan" alone or "Juan Obiang" do not.
 */
export function normalizeName(name: string): string[] {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, ' ')
    .split(/[\s'-]+/)
    .filter(Boolean);
}

export function namesMatch(typed: string, registered: string): boolean {
  const t = normalizeName(typed);
  const r = new Set(normalizeName(registered));
  return t.length >= 2 && t.every((w) => r.has(w));
}

/** "Juan Pablo Mba Nsue" -> "Juan M." (first name + initial of the first surname). */
export function displayName(registered: string, firstNames = 1): string {
  const parts = registered.trim().split(/\s+/);
  const first = parts[0] ?? '';
  const surname = parts[Math.max(firstNames, parts.length > 2 ? parts.length - 2 : 1)] ?? '';
  return surname ? `${first} ${surname.charAt(0).toUpperCase()}.` : first;
}
