import { StyleSheet, Text as RNText, TextProps, TextStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { fonts, type as typeScale, TextVariant, Colors } from '../theme/tokens';

interface Props extends TextProps {
  variant?: TextVariant;
  color?: keyof Colors;
  align?: TextStyle['textAlign'];
  /** Tabular digits so amounts line up in lists. */
  numeric?: boolean;
}

const DISPLAY: readonly string[] = [fonts.display, fonts.displaySemi];

/** The Velynt font for a variant and an optional weight from the screen's style (no system fallback on Android). */
function familyFor(base: string, weight: TextStyle['fontWeight']): string {
  const heavy = weight === 'bold' || (typeof weight === 'string' && Number(weight) >= 600) || (typeof weight === 'number' && weight >= 600);
  const medium = weight === '500' || weight === 500;
  if (DISPLAY.includes(base)) return heavy ? fonts.display : base;
  if (heavy) return fonts.bodySemi;
  if (medium) return fonts.bodyMed;
  return base;
}

export function Text({ variant = 'body', color = 'text', align, numeric, style, ...rest }: Props) {
  const { colors } = useTheme();
  const scale = typeScale[variant];
  const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  const fontFamily = flat.fontFamily ?? familyFor(scale.fontFamily, flat.fontWeight);
  return (
    <RNText
      {...rest}
      maxFontSizeMultiplier={1.6}
      style={[
        scale,
        { color: colors[color], textAlign: align },
        numeric && { fontVariant: ['tabular-nums'] },
        variant === 'overline' && { textTransform: 'uppercase' },
        style,
        { fontFamily, fontWeight: undefined }
      ]}
    />
  );
}
