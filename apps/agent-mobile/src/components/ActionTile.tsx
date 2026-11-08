import { LucideIcon } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space, tintBg, touch } from '../theme/tokens';
import { Text } from './Text';

/** Big primary action on the dashboard (>= 96dp tall): plum when it is one of the two main ones, else a tinted icon on cream. */
export function ActionTile({ label, Icon, onPress, disabled, emphasis, badge, tint }: { label: string; Icon: LucideIcon; onPress: () => void; disabled?: boolean; emphasis?: boolean; badge?: string; tint?: string }) {
  const { colors } = useTheme();
  const iconColor = emphasis ? colors.onPrimary : tint ?? colors.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={badge ? `${label}, ${badge}` : label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        { backgroundColor: emphasis ? colors.primary : colors.surfaceAlt, opacity: disabled ? (badge ? 0.7 : 0.45) : pressed ? 0.88 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] },
        emphasis && styles.lift
      ]}
    >
      <View style={styles.top}>
        <View style={[styles.icon, { backgroundColor: emphasis ? 'rgba(255,255,255,0.16)' : tintBg(tint ?? colors.primary) }]}>
          <Icon size={24} color={iconColor} strokeWidth={1.8} />
        </View>
        {badge ? (
          <View style={[styles.badge, { backgroundColor: colors.surface }]}>
            <Text variant="caption" color="textMuted" style={{ fontSize: 11 }}>
              {badge}
            </Text>
          </View>
        ) : null}
      </View>
      <Text variant="bodyStrong" style={{ color: emphasis ? colors.onPrimary : colors.text }}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: { flex: 1, minHeight: touch.tile, borderRadius: radius.lg, padding: space.lg, justifyContent: 'space-between', gap: space.md },
  lift: { shadowColor: '#4A2040', shadowOpacity: 0.22, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  badge: { borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 2 },
  icon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }
});
