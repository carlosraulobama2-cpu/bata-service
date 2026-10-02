import { router } from 'expo-router';
import { ChevronRight } from 'lucide-react-native';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { CommissionSummary, Transaction } from '../../../api/types';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { Screen } from '../../../components/Screen';
import { ErrorState, Skeleton } from '../../../components/States';
import { Text } from '../../../components/Text';
import { useCommissionLines, useCommissionSummary } from '../../../features/queries';
import { useTheme } from '../../../theme/ThemeProvider';
import { radius, space } from '../../../theme/tokens';
import { formatDateTime, money } from '../../../utils/format';

/**
 * What the agent earns. Velynt pays the commission into the float with each operation (same ledger
 * entry), so there is nothing "pending": this screen is what was earned, by period and by type.
 */
export default function CommissionsScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const summary = useCommissionSummary();
  const lines = useCommissionLines();
  const s = summary.data;
  const rows = (lines.data?.pages.flatMap((p) => p.data) ?? []).filter((tx) => tx.commission > 0);

  return (
    <Screen scroll edges={['top']} refreshing={summary.isRefetching || lines.isRefetching} onRefresh={() => Promise.all([summary.refetch(), lines.refetch()])}>
      <Text variant="title" style={styles.title} accessibilityRole="header">
        {t('commissions.title')}
      </Text>

      {summary.error ? <ErrorState error={summary.error} onRetry={() => summary.refetch()} /> : null}

      <View style={[styles.hero, { backgroundColor: colors.successSoft }]}>
        <Text variant="label" color="success">
          {t('commissions.month')}
        </Text>
        {s ? (
          <Text variant="display" numeric color="success" adjustsFontSizeToFit numberOfLines={1}>
            {money(s.this_month)}
          </Text>
        ) : (
          <Skeleton width={180} height={40} />
        )}
        <Text variant="caption" color="success">
          {t('commissions.paidAtOnce')}
        </Text>
      </View>

      <View style={styles.grid}>
        <Period label={t('commissions.today')} value={s?.today} />
        <Period label={t('commissions.week')} value={s?.last_7_days} />
      </View>

      <Text variant="overline" color="textMuted" style={styles.section}>
        {t('commissions.byType')}
      </Text>
      <Card>{s ? <Breakdown summary={s} /> : <Skeleton height={80} />}</Card>

      <Text variant="overline" color="textMuted" style={styles.section}>
        {t('commissions.latest')}
      </Text>
      <Card padded={false} style={{ overflow: 'hidden' }}>
        {lines.isLoading ? (
          <View style={{ padding: space.lg, gap: space.md }}>
            <Skeleton height={36} />
            <Skeleton height={36} />
          </View>
        ) : rows.length === 0 ? (
          <Text variant="body" color="textMuted" style={{ padding: space.lg }}>
            {t('commissions.noneThisMonth')}
          </Text>
        ) : (
          rows.map((tx, i) => <Line key={tx.id} tx={tx} last={i === rows.length - 1} />)
        )}
      </Card>
      {lines.hasNextPage ? (
        <Button variant="ghost" label={t('common.loadMore')} loading={lines.isFetchingNextPage} onPress={() => void lines.fetchNextPage()} />
      ) : lines.isFetchingNextPage ? (
        <ActivityIndicator color={colors.primary} />
      ) : null}

      <Text variant="caption" color="textMuted" style={{ marginTop: space.lg }}>
        {t('commissions.note')}
      </Text>
    </Screen>
  );
}

function Period({ label, value }: { label: string; value: number | undefined }) {
  return (
    <Card style={styles.cell}>
      <Text variant="caption" color="textMuted">
        {label}
      </Text>
      {value === undefined ? (
        <Skeleton width={100} height={24} style={{ marginTop: 6 }} />
      ) : (
        <Text variant="headline" numeric numberOfLines={1} adjustsFontSizeToFit>
          {money(value)}
        </Text>
      )}
    </Card>
  );
}

/** One bar per operation type, relative to the biggest; the figure is always written, not only drawn. */
function Breakdown({ summary }: { summary: CommissionSummary }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const max = Math.max(1, ...summary.by_type_this_month.map((r) => r.amount));
  if (summary.by_type_this_month.length === 0) {
    return (
      <Text variant="body" color="textMuted">
        {t('commissions.noneThisMonth')}
      </Text>
    );
  }
  return (
    <View style={{ gap: space.lg }}>
      {summary.by_type_this_month.map((r) => (
        <View key={r.operation_type} style={{ gap: space.xs }} accessible accessibilityLabel={`${t(`types.${r.operation_type}`)}: ${money(r.amount)}, ${t('commissions.operations', { count: r.count })}`}>
          <View style={styles.breakRow}>
            <Text variant="bodyStrong">{t(`types.${r.operation_type}`)}</Text>
            <Text variant="bodyStrong" numeric>
              {money(r.amount)}
            </Text>
          </View>
          <View style={[styles.track, { backgroundColor: colors.surfaceAlt }]}>
            <View style={[styles.bar, { backgroundColor: colors.success, width: `${Math.max(4, (r.amount / max) * 100)}%` }]} />
          </View>
          <Text variant="caption" color="textMuted">
            {t('commissions.operations', { count: r.count })}
          </Text>
        </View>
      ))}
    </View>
  );
}

function Line({ tx, last }: { tx: Transaction; last: boolean }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={() => router.push(`/transaction/${tx.id}`)}
      accessibilityRole="button"
      style={({ pressed }) => [styles.line, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }, pressed && { backgroundColor: colors.neutralSoft }]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong">
          {t(`types.${tx.type}`)} · {tx.reference}
        </Text>
        <Text variant="caption" color="textMuted">
          {t('commissions.onAmount', { amount: money(tx.amount) })} · {formatDateTime(tx.created_at)}
        </Text>
      </View>
      <Text variant="bodyStrong" numeric color="success">
        {money(tx.commission, { sign: true })}
      </Text>
      <ChevronRight size={18} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  title: { paddingTop: space.lg, paddingBottom: space.lg },
  hero: { borderRadius: radius.xl, padding: space.xl, gap: space.xs, marginBottom: space.lg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  cell: { flexBasis: '48%', flexGrow: 1 },
  section: { marginTop: space.xl, marginBottom: space.sm },
  breakRow: { flexDirection: 'row', justifyContent: 'space-between' },
  track: { height: 10, borderRadius: 5, overflow: 'hidden' },
  bar: { height: 10, borderRadius: 5 },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, minHeight: 60 }
});
