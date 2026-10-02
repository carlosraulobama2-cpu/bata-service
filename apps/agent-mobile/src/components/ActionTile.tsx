import { LucideIcon } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space, touch } from '../theme/tokens';
import { Text } from './Text';

/** Big primary action on the dashboard (≥ 96dp tall). */
export function ActionTile({ label, Icon, onPress, disabled, emphasis, badge }: { label: string; Icon: LucideIcon; onPress: () => void; disabled?: boolean; emphasis?: boolean; badge?: string }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={badge ? `${label}, ${badge}` : label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        { backgroundColor: emphasis ? colors.primary : colors.surface, borderColor: colors.border, opacity: disabled ? (badge ? 0.7 : 0.45) : pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] }
      ]}
    >
      <View style={styles.top}>
        <View style={[styles.icon, { backgroundColor: emphasis ? 'rgba(255,255,255,0.18)' : colors.primarySoft }]}>
          <Icon size={24} color={emphasis ? colors.onPrimary : colors.primary} strokeWidth={2.2} />
        </View>
        {badge ? (
          <View style={[styles.badge, { backgroundColor: colors.neutralSoft }]}>
            <Text variant="caption" color="textMuted" style={{ fontSize: 11, fontWeight: '600' }}>
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
  tile: { flex: 1, minHeight: touch.tile, borderRadius: radius.lg, padding: space.lg, justifyContent: 'space-between', borderWidth: StyleSheet.hairlineWidth, gap: space.md },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  badge: { borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 2 },
  icon: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' }
});
