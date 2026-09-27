/**
 * Design tokens (docs/02-ux-ui.md §2). Components read colors only from
 * here, so the brand can change without touching screens.
 * Contrast of text on bg/surface is ≥ 4.5:1 in both modes (WCAG AA).
 */
export const palette = {
  light: {
    bg: '#F4F6F9',
    surface: '#FFFFFF',
    surfaceAlt: '#EEF2F7',
    text: '#0F1419',
    textMuted: '#5B6573',
    textInverse: '#FFFFFF',
    border: '#E2E6EC',
    primary: '#0B5FFF',
    primaryPressed: '#0848C4',
    primarySoft: '#E6EEFF',
    onPrimary: '#FFFFFF',
    hero: '#0A2A66',
    heroText: '#FFFFFF',
    heroMuted: '#B8C8EA',
    success: '#0F7B55',
    successSoft: '#E3F5EE',
    warning: '#9A5B00',
    warningSoft: '#FFF3DC',
    danger: '#C4271B',
    dangerSoft: '#FDE8E6',
    info: '#1F5FD1',
    infoSoft: '#E6EEFF',
    neutralSoft: '#EEF1F5',
    overlay: 'rgba(8, 15, 30, 0.55)',
    skeleton: '#E4E8EE'
  },
  dark: {
    bg: '#0B0F14',
    surface: '#151B23',
    surfaceAlt: '#1C2430',
    text: '#EEF2F7',
    textMuted: '#A3AEBD',
    textInverse: '#0B0F14',
    border: '#27313E',
    primary: '#5B8CFF',
    primaryPressed: '#7AA2FF',
    primarySoft: '#1A2B4F',
    onPrimary: '#0B0F14',
    hero: '#12305F',
    heroText: '#FFFFFF',
    heroMuted: '#AFC2E8',
    success: '#43C995',
    successSoft: '#12302A',
    warning: '#F2B24C',
    warningSoft: '#33260F',
    danger: '#FF6B5E',
    dangerSoft: '#3A1916',
    info: '#7FA8FF',
    infoSoft: '#1A2B4F',
    neutralSoft: '#1C2430',
    overlay: 'rgba(0, 0, 0, 0.6)',
    skeleton: '#1F2833'
  }
} as const;

export type ColorScheme = keyof typeof palette;
export type Colors = { [K in keyof (typeof palette)['light']]: string };

export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32, huge: 48 } as const;

export const radius = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 } as const;

/** Minimum touch target (Android guidance 48dp). */
export const touch = { min: 48, button: 56, tile: 96 } as const;

export const type = {
  display: { fontSize: 34, lineHeight: 40, fontWeight: '700' as const, letterSpacing: -0.5 },
  amount: { fontSize: 32, lineHeight: 38, fontWeight: '700' as const, letterSpacing: -0.4 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700' as const },
  headline: { fontSize: 18, lineHeight: 24, fontWeight: '600' as const },
  body: { fontSize: 16, lineHeight: 22, fontWeight: '400' as const },
  bodyStrong: { fontSize: 16, lineHeight: 22, fontWeight: '600' as const },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '600' as const },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' as const },
  overline: { fontSize: 12, lineHeight: 16, fontWeight: '600' as const, letterSpacing: 0.6 }
} as const;

export type TextVariant = keyof typeof type;
