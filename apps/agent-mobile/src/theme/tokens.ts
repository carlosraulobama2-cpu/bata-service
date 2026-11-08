/**
 * Design tokens. Components read colors only from here, so the brand can change without touching screens.
 * Since November 2026 they are Velynt's own (the customer app's frontend/src/theme.ts and DESIGN.md): plum, cream
 * and sunset, Space Grotesk for titles and amounts, Outfit for text, pill buttons and groups by fill, not lines.
 * Contrast of text on bg/surface is ≥ 4.5:1 in both modes (WCAG AA).
 */
export const palette = {
  light: {
    bg: '#FDFCFB',
    surface: '#FFFFFF',
    surfaceAlt: '#F4F1EE',
    text: '#2D1623',
    textMuted: '#8A7482',
    textInverse: '#FDFCFB',
    border: '#E8E2E4',
    primary: '#4A2040',
    primaryPressed: '#3A1832',
    primarySoft: '#F3E8EF',
    onPrimary: '#FDFCFB',
    hero: '#4A2040',
    heroEnd: '#6E2F5C',
    heroText: '#FDFCFB',
    heroMuted: '#E9C9D6',
    sunset: '#F47144',
    gold: '#D4AF37',
    success: '#15803D',
    successSoft: '#E7F4EC',
    warning: '#B4531F',
    warningSoft: '#FDEEE6',
    danger: '#B3463F',
    dangerSoft: '#F8E5E3',
    info: '#4A2040',
    infoSoft: '#F3E8EF',
    neutralSoft: '#F4F1EE',
    overlay: 'rgba(45, 22, 35, 0.55)',
    skeleton: '#EFE9EC'
  },
  dark: {
    bg: '#0F070C',
    surface: '#382430',
    surfaceAlt: '#2A1A25',
    text: '#F9ECEE',
    textMuted: '#B49CA9',
    textInverse: '#0F070C',
    border: '#4A2F3E',
    primary: '#F4A6A8',
    primaryPressed: '#F7BCBE',
    primarySoft: '#3A2232',
    onPrimary: '#0F070C',
    hero: '#4A2040',
    heroEnd: '#6E2F5C',
    heroText: '#FDFCFB',
    heroMuted: '#E9C9D6',
    sunset: '#FF8A5E',
    gold: '#E4C36A',
    success: '#4ADE80',
    successSoft: '#13301F',
    warning: '#FF8A5E',
    warningSoft: '#3A1E12',
    danger: '#E8857E',
    dangerSoft: '#3A1916',
    info: '#F4A6A8',
    infoSoft: '#3A2232',
    neutralSoft: '#2A1A25',
    overlay: 'rgba(0, 0, 0, 0.6)',
    skeleton: '#33212D'
  }
} as const;

export type ColorScheme = keyof typeof palette;
export type Colors = { [K in keyof (typeof palette)['light']]: string };

/**
 * Icon colors, the same as the customer app's `tints`: each destination keeps its color everywhere, on a circle of
 * the same color at 13 % (tintBg). The only colors outside the palette, and only for small icons.
 */
export const tints = {
  orange: '#F46F3F', blue: '#2F7DF6', green: '#16A34A', teal: '#0E9F8E', pink: '#E8508A',
  purple: '#8B5CF6', amber: '#D9921A', indigo: '#5B5BD6', red: '#E0475B', slate: '#64748B'
} as const;
export const tintBg = (hex: string) => `${hex}22`;

export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32, huge: 48 } as const;

/** Velynt's radii: details 8, fields 12, groups 20, sheets 24, the balance card 28, buttons and chips as pills. */
export const radius = { sm: 8, md: 12, lg: 20, xl: 24, card: 28, pill: 999 } as const;

/** Minimum touch target (Android guidance 48dp). */
export const touch = { min: 48, button: 56, tile: 96 } as const;

/** The fonts loaded in app/_layout.tsx (the customer app's). */
export const fonts = {
  display: 'SpaceGrotesk_700Bold',
  displaySemi: 'SpaceGrotesk_600SemiBold',
  body: 'Outfit_400Regular',
  bodyMed: 'Outfit_500Medium',
  bodySemi: 'Outfit_600SemiBold'
} as const;

export const type = {
  display: { fontFamily: fonts.display, fontSize: 34, lineHeight: 40, letterSpacing: -1.1 },
  amount: { fontFamily: fonts.display, fontSize: 32, lineHeight: 38, letterSpacing: -1 },
  title: { fontFamily: fonts.display, fontSize: 24, lineHeight: 30, letterSpacing: -0.6 },
  headline: { fontFamily: fonts.displaySemi, fontSize: 19, lineHeight: 25, letterSpacing: -0.2 },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 22 },
  bodyStrong: { fontFamily: fonts.bodyMed, fontSize: 16, lineHeight: 22 },
  label: { fontFamily: fonts.bodyMed, fontSize: 14, lineHeight: 20 },
  caption: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18 },
  overline: { fontFamily: fonts.bodyMed, fontSize: 11, lineHeight: 16, letterSpacing: 1.8 }
} as const;

export type TextVariant = keyof typeof type;
