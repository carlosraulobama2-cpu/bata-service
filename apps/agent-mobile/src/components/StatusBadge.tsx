import { CheckCircle2 } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TransactionStatus } from '../api/types';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';
import { Text } from './Text';

/** Status is always icon + text + color, never color alone. */
export function StatusBadge({ status, size = 'md' }: { status: TransactionStatus; size?: 'sm' | 'md' }) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const map = {
    completed: { fg: colors.success, bg: colors.successSoft, Icon: CheckCircle2 }
  }[status];
  const iconSize = size === 'sm' ? 12 : 14;
  return (
    <View style={[styles.badge, { backgroundColor: map.bg }, size === 'sm' && styles.sm]} accessibilityLabel={t(`status.${status}`)}>
      <map.Icon size={iconSize} color={map.fg} strokeWidth={2.5} />
      <Text variant={size === 'sm' ? 'caption' : 'label'} style={{ color: map.fg, fontWeight: '600' }}>
        {t(`status.${status}`)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', gap: space.xs, paddingHorizontal: space.sm, paddingVertical: space.xs, borderRadius: radius.pill, alignSelf: 'flex-start' },
  sm: { paddingHorizontal: 6, paddingVertical: 2 }
});
