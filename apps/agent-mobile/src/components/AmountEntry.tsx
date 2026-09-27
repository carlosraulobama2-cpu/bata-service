import { Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';
import { money } from '../utils/format';
import { Keypad } from './Keypad';
import { Text } from './Text';
import { useCompact } from '../theme/useCompact';

const MAX_DIGITS = 9;
const QUICK = [5_000, 10_000, 25_000, 50_000];

/** Amount in whole XAF typed on our keypad (no decimals, no system keyboard). */
export function AmountEntry({ value, onChange, hint, error }: { value: number; onChange: (v: number) => void; hint?: string; error?: string | null }) {
  const { colors } = useTheme();
  const compact = useCompact();
  const digits = value > 0 ? String(value) : '';
  const set = (d: string) => onChange(d ? Number(d) : 0);
  return (
    <View style={styles.wrap}>
      <View style={styles.flexTop} />
      <View style={[styles.display, compact && { paddingVertical: space.xs }]} accessibilityLiveRegion="polite">
        <Text variant="display" numeric align="center" adjustsFontSizeToFit numberOfLines={1} style={{ color: value ? colors.text : colors.textMuted, fontSize: compact ? 36 : 44, lineHeight: compact ? 44 : 52 }}>
          {money(value)}
        </Text>
        <Text variant="label" color="danger" align="center" accessibilityRole="alert" style={{ minHeight: 20 }}>
          {error ?? ''}
        </Text>
        {hint ? (
          <Text variant="caption" color="textMuted" align="center">
            {hint}
          </Text>
        ) : null}
      </View>
      <View style={styles.quick}>
        {QUICK.map((q) => (
          <Pressable
            key={q}
            accessibilityRole="button"
            accessibilityLabel={money(q)}
            onPress={() => onChange(q)}
            style={({ pressed }) => [styles.chip, { backgroundColor: value === q ? colors.primarySoft : colors.surface, borderColor: value === q ? colors.primary : colors.border, opacity: pressed ? 0.7 : 1 }]}
          >
            <Text variant="label" numeric style={{ color: value === q ? colors.primary : colors.text }}>
              {money(q).replace(/\s\S+$/, '')}
            </Text>
          </Pressable>
        ))}
      </View>
      <Keypad
        onDigit={(d) => {
          if (digits.length >= MAX_DIGITS || (!digits && d === '0')) return;
          set(digits + d);
        }}
        onDelete={() => set(digits.slice(0, -1))}
        extra={{ label: '000', accessibilityLabel: 'Tres ceros', onPress: () => digits && digits.length + 3 <= MAX_DIGITS && set(`${digits}000`) }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md, flex: 1 },
  flexTop: { flex: 1 },
  display: { paddingVertical: space.lg, gap: space.xs },
  quick: { flexDirection: 'row', gap: space.sm },
  chip: { flex: 1, height: 40, borderRadius: radius.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center' }
});
