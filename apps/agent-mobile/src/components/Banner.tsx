import { AlertTriangle, Info, WifiOff } from 'lucide-react-native';
import { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';
import { Text } from './Text';

type Tone = 'info' | 'warning' | 'danger' | 'offline';

export function Banner({ tone = 'info', children, onPress, action }: { tone?: Tone; children: ReactNode; onPress?: () => void; action?: string }) {
  const { colors } = useTheme();
  const cfg = {
    info: { fg: colors.info, bg: colors.infoSoft, Icon: Info },
    warning: { fg: colors.warning, bg: colors.warningSoft, Icon: AlertTriangle },
    danger: { fg: colors.danger, bg: colors.dangerSoft, Icon: AlertTriangle },
    offline: { fg: colors.textMuted, bg: colors.neutralSoft, Icon: WifiOff }
  }[tone];
  const content = (
    <View style={[styles.row, { backgroundColor: cfg.bg }]}>
      <cfg.Icon size={18} color={cfg.fg} />
      <Text variant="label" style={[styles.text, { color: cfg.fg }]}>
        {children}
      </Text>
      {action ? (
        <Text variant="label" style={{ color: cfg.fg, textDecorationLine: 'underline' }}>
          {action}
        </Text>
      ) : null}
    </View>
  );
  return onPress ? (
    <Pressable accessibilityRole="button" onPress={onPress}>
      {content}
    </Pressable>
  ) : (
    <View accessibilityRole="alert">{content}</View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md },
  text: { flex: 1, fontWeight: '500' }
});
