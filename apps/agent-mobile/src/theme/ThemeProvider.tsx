import { createContext, ReactNode, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { ColorScheme, Colors, palette } from './tokens';

interface Theme {
  scheme: ColorScheme;
  colors: Colors;
}

const ThemeContext = createContext<Theme>({ scheme: 'light', colors: palette.light });

/** Follows the system light/dark setting. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const value = useMemo<Theme>(() => {
    const scheme: ColorScheme = system === 'dark' ? 'dark' : 'light';
    return { scheme, colors: palette[scheme] };
  }, [system]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
