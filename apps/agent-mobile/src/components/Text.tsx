import { Text as RNText, TextProps, TextStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { type as typeScale, TextVariant, Colors } from '../theme/tokens';

interface Props extends TextProps {
  variant?: TextVariant;
  color?: keyof Colors;
  align?: TextStyle['textAlign'];
  /** Tabular digits so amounts line up in lists. */
  numeric?: boolean;
}

export function Text({ variant = 'body', color = 'text', align, numeric, style, ...rest }: Props) {
  const { colors } = useTheme();
  return (
    <RNText
      {...rest}
      maxFontSizeMultiplier={1.6}
      style={[typeScale[variant], { color: colors[color], textAlign: align }, numeric && { fontVariant: ['tabular-nums'] }, variant === 'overline' && { textTransform: 'uppercase' }, style]}
    />
  );
}
