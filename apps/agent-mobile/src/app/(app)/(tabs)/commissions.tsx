import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Card } from '../../../components/Card';
import { InfoRow } from '../../../components/InfoRow';
import { Screen } from '../../../components/Screen';
import { Skeleton } from '../../../components/States';
import { Text } from '../../../components/Text';
import { useBalance, useTotals } from '../../../features/queries';
import { useTheme } from '../../../theme/ThemeProvider';
import { radius, space } from '../../../theme/tokens';
import { money } from '../../../utils/format';

export default function CommissionsScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const balance = useBalance();
  const today = useTotals('today');
  const week = useTotals('last_7_days');
  const month = useTotals('this_month');
  const refreshing = balance.isRefetching || today.isRefetching || week.isRefetching || month.isRefetching;

  return (
    <Screen scroll edges={['top']} refreshing={refreshing} onRefresh={() => Promise.all([balance.refetch(), today.refetch(), week.refetch(), month.refetch()])}>
      <Text variant="title" style={styles.title} accessibilityRole="header">
        {t('commissions.title')}
      </Text>

      <View style={[styles.hero, { backgroundColor: colors.successSoft }]}>
        <Text variant="label" color="success">
          {t('commissions.pending')}
        </Text>
        {balance.data ? (
          <Text variant="display" numeric color="success">
            {money(balance.data.commissions_pending.amount)}
          </Text>
        ) : (
          <Skeleton width={180} height={40} />
        )}
        <Text variant="caption" color="success">
          {t('commissions.pendingCaption')}
        </Text>
      </View>

      <View style={styles.row}>
        <Period label={t('commissions.today')} value={today.data?.commissions} />
        <Period label={t('commissions.week')} value={week.data?.commissions} />
      </View>
      <Period label={t('commissions.month')} value={month.data?.commissions} wide />

      {month.data ? (
        <Card style={{ marginTop: space.lg }}>
          <Text variant="overline" color="textMuted" style={{ marginBottom: space.xs }}>
            {t('commissions.volume')}
          </Text>
          <InfoRow label={t('dashboard.cashIn')} value={money(month.data.cash_in)} />
          <InfoRow label={t('dashboard.cashOut')} value={money(month.data.cash_out)} last />
        </Card>
      ) : null}
      <Text variant="caption" color="textMuted" style={{ marginTop: space.lg }}>
        {t('commissions.note')}
      </Text>
    </Screen>
  );
}

function Period({ label, value, wide }: { label: string; value: number | undefined; wide?: boolean }) {
  return (
    <Card style={wide ? { marginTop: space.sm } : styles.half}>
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

const styles = StyleSheet.create({
  title: { paddingTop: space.lg, paddingBottom: space.lg },
  hero: { borderRadius: radius.xl, padding: space.xl, gap: space.xs, marginBottom: space.lg },
  row: { flexDirection: 'row', gap: space.sm },
  half: { flex: 1 }
});
