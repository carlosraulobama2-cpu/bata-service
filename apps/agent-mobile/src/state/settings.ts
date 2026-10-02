import { create } from 'zustand';
import type { Preferences } from '../api/types';

/**
 * The person's settings, applied to the whole app (theme, hidden balance). Saved on the server so they
 * follow the agent to a new phone; loaded after sign-in.
 */
interface SettingsState {
  theme: Preferences['theme'];
  hideBalance: boolean;
  apply: (prefs: Partial<Preferences>) => void;
}

export const useSettings = create<SettingsState>((set) => ({
  theme: 'system',
  hideBalance: false,
  apply: (prefs) =>
    set((s) => ({
      theme: prefs.theme ?? s.theme,
      hideBalance: prefs.hide_balance ?? s.hideBalance
    }))
}));
