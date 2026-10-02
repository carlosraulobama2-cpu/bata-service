import { createContext, ReactNode, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { useSettings } from '../state/settings';
import { ColorScheme, Colors, palette } from './tokens';

interface Theme {
  scheme: ColorScheme;
  colors: Colors;
}

const ThemeContext = createContext<Theme>({ scheme: 'light', colors: palette.light });

/** Follows the system light/dark setting unless the agent chose one in Ajustes. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const chosen = useSettings((s) => s.theme);
  const value = useMemo<Theme>(() => {
    const scheme: ColorScheme = chosen === 'system' ? (system === 'dark' ? 'dark' : 'light') : chosen;
    return { scheme, colors: palette[scheme] };
  }, [system, chosen]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
