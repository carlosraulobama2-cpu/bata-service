import { ArrowDownLeft, ArrowUpRight, QrCode, Receipt } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { Transaction } from '../api/types';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';
import { formatTime, money } from '../utils/format';
import { StatusBadge } from './StatusBadge';
import { Text } from './Text';

/**
 * Money direction from the AGENT's point of view:
 * cash-in = customer receives e-money, agent's float goes down (but the agent receives cash).
 * We show the operation amount without a sign and let the type/icon carry the meaning.
 */
export function TransactionRow({ tx, onPress, showDate }: { tx: Transaction; onPress?: () => void; showDate?: string }) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const Icon = tx.type === 'cash_out' ? ArrowUpRight : tx.type === 'cash_in' ? ArrowDownLeft : tx.type === 'qr_payment' ? QrCode : Receipt;
  const muted = tx.status === 'failed' || tx.status === 'cancelled';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${t(`types.${tx.type}`)} ${money(tx.amount)}, ${t(`status.${tx.status}`)}, ${formatTime(tx.created_at)}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.neutralSoft }]}
    >
      <View style={[styles.icon, { backgroundColor: colors.surfaceAlt }]}>
        <Icon size={20} color={colors.text} />
      </View>
      <View style={styles.middle}>
        <Text variant="bodyStrong">{t(`types.${tx.type}`)}</Text>
        <Text variant="caption" color="textMuted">
          {[tx.customer_masked, showDate ?? formatTime(tx.created_at)].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <View style={styles.right}>
        <Text variant="bodyStrong" numeric style={muted ? { textDecorationLine: 'line-through', color: colors.textMuted } : undefined}>
          {money(tx.amount)}
        </Text>
        {tx.status === 'completed' ? (
          tx.commission > 0 ? (
            <Text variant="caption" color="success" numeric>
              +{money(tx.commission)}
            </Text>
          ) : null
        ) : (
          <StatusBadge status={tx.status} size="sm" />
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md, paddingHorizontal: space.sm, borderRadius: radius.md, minHeight: 64 },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  middle: { flex: 1, gap: 2 },
  right: { alignItems: 'flex-end', gap: 4 }
});
