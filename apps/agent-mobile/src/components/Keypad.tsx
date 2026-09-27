import * as Haptics from 'expo-haptics';
import { Delete } from 'lucide-react-native';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';
import { Text } from './Text';
import { useCompact } from '../theme/useCompact';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'extra', '0', 'del'] as const;

interface Props {
  onDigit: (d: string) => void;
  onDelete: () => void;
  /** Optional key bottom-left (e.g. "000" for amounts, biometrics icon for PIN). */
  extra?: { label?: string; icon?: React.ReactNode; onPress: () => void; accessibilityLabel: string };
  disabled?: boolean;
}

/**
 * Own numeric keypad: big keys (≥ 64dp), no system keyboard jumping around,
 * and PIN digits never pass through the OS keyboard or autocorrect.
 */
export function Keypad({ onDigit, onDelete, extra, disabled }: Props) {
  const { colors } = useTheme();
  const compact = useCompact();
  const keyHeight = compact ? 52 : 64;
  const tap = (fn: () => void) => () => {
    if (disabled) return;
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    fn();
  };
  return (
    <View style={styles.grid}>
      {KEYS.map((k) => {
        if (k === 'extra' && !extra) return <View key={k} style={[styles.key, { height: keyHeight }]} />;
        const label = k === 'extra' ? extra!.accessibilityLabel : k === 'del' ? 'Borrar' : k;
        return (
          <Pressable
            key={k}
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={tap(k === 'del' ? onDelete : k === 'extra' ? extra!.onPress : () => onDigit(k))}
            onLongPress={k === 'del' ? tap(() => {
              for (let i = 0; i < 12; i++) onDelete();
            }) : undefined}
            style={({ pressed }) => [styles.key, { height: keyHeight, backgroundColor: pressed ? colors.neutralSoft : 'transparent', opacity: disabled ? 0.4 : 1 }]}
          >
            {k === 'del' ? (
              <Delete size={26} color={colors.text} />
            ) : k === 'extra' ? (
              extra!.icon ?? <Text variant="title">{extra!.label}</Text>
            ) : (
              <Text variant="title" style={styles.digit}>
                {k}
              </Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: space.xs },
  key: { width: '32%', height: 64, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
  digit: { fontSize: 28, lineHeight: 34, fontWeight: '500' }
});
