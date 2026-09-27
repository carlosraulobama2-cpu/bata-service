import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { LimitView } from '../../api/types';
import { Banner } from '../../components/Banner';
import { Card } from '../../components/Card';
import { Header } from '../../components/Header';
import { Screen } from '../../components/Screen';
import { ErrorState, Skeleton } from '../../components/States';
import { Text } from '../../components/Text';
import { useLimits } from '../../features/queries';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';
import { money } from '../../utils/format';

export default function LimitsScreen() {
  const { t } = useTranslation();
  const q = useLimits();
  return (
    <Screen header={<Header title={t('limits.title')} />} scroll refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      <View style={styles.content}>
        {q.data?.limits.some((l) => l.cooldown_applied) ? <Banner tone="info">{t('limits.cooldown')}</Banner> : null}
        {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
        {q.isLoading ? <Skeleton height={220} /> : null}
        {q.data?.limits.map((l) => <LimitCard key={l.operation_type} limit={l} />)}
      </View>
    </Screen>
  );
}

function LimitCard({ limit }: { limit: LimitView }) {
  const { t } = useTranslation();
  return (
    <Card>
      <Text variant="headline" style={{ marginBottom: space.md }}>
        {t(`types.${limit.operation_type}`)}
      </Text>
      <View style={styles.perTx}>
        <Text variant="body" color="textMuted">
          {t('limits.perTransaction')}
        </Text>
        <Text variant="bodyStrong" numeric>
          {money(limit.per_transaction.max)}
        </Text>
      </View>
      <Meter label={t('limits.daily')} used={limit.daily.used} max={limit.daily.max} />
      {limit.daily.count_max ? (
        <Text variant="caption" color="textMuted" style={{ marginTop: -space.xs, marginBottom: space.md }}>
          {t('limits.operationsToday', { used: limit.daily.count_used, max: limit.daily.count_max })}
        </Text>
      ) : null}
      <Meter label={t('limits.monthly')} used={limit.monthly.used} max={limit.monthly.max} />
    </Card>
  );
}

function Meter({ label, used, max }: { label: string; used: number; max: number }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const ratio = max > 0 ? Math.min(1, used / max) : 0;
  const color = ratio > 0.9 ? colors.danger : ratio > 0.7 ? colors.warning : colors.primary;
  return (
    <View style={styles.meter} accessibilityLabel={`${label}: ${t('limits.usedOf', { used: money(used), max: money(max) })}`}>
      <View style={styles.meterHead}>
        <Text variant="body" color="textMuted">
          {label}
        </Text>
        <Text variant="label" numeric>
          {t('limits.usedOf', { used: money(used), max: money(max) })}
        </Text>
      </View>
      <View style={[styles.track, { backgroundColor: colors.neutralSoft }]}>
        <View style={[styles.fill, { width: `${Math.round(ratio * 100)}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.lg, paddingTop: space.sm },
  perTx: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: space.lg },
  meter: { gap: space.sm, marginBottom: space.md },
  meterHead: { flexDirection: 'row', justifyContent: 'space-between', gap: space.sm },
  track: { height: 8, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill }
});
