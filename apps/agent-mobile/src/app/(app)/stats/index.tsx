import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../../api/endpoints';
import { Card } from '../../../components/Card';
import { Chips } from '../../../components/Chips';
import { Header } from '../../../components/Header';
import { Screen } from '../../../components/Screen';
import { ErrorState } from '../../../components/States';
import { Text } from '../../../components/Text';
import { useTheme } from '../../../theme/ThemeProvider';
import { radius, space } from '../../../theme/tokens';
import { formatDate, money } from '../../../utils/format';

/** Deposits, withdrawals and commissions per day: simple bars, the numbers always written. */
export default function StatsScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [days, setDays] = useState<'7' | '30'>('7');
  const stats = useQuery({ queryKey: ['stats', days], queryFn: () => endpoints.stats(Number(days)) });
  const close = () => (router.canGoBack() ? router.back() : router.replace('/home'));
  const list = stats.data ?? [];
  const total = (pick: (d: (typeof list)[number]) => number) => list.reduce((sum, d) => sum + pick(d), 0);
  const max = Math.max(1, ...list.map((d) => d.cash_in.volume + d.cash_out.volume));
  const best = list.reduce<(typeof list)[number] | null>((b, d) => (!b || d.commission > b.commission ? d : b), null);

  return (
    <Screen header={<Header leading="close" onLeading={close} title={t('stats.title')} />} scroll>
      <View style={styles.content}>
        <Chips<'7' | '30'> value={days} onChange={setDays} options={[{ value: '7', label: t('stats.days7') }, { value: '30', label: t('stats.days30') }]} />
        {stats.error ? <ErrorState error={stats.error} onRetry={() => stats.refetch()} /> : null}
        <View style={styles.grid}>
          {[
            { label: t('stats.deposits'), value: money(total((d) => d.cash_in.volume)) },
            { label: t('stats.withdrawals'), value: money(total((d) => d.cash_out.volume)) },
            { label: t('stats.commissions'), value: money(total((d) => d.commission)) },
            { label: t('stats.operations'), value: String(total((d) => d.cash_in.count + d.cash_out.count)) }
          ].map((k) => (
            <Card key={k.label} style={styles.kpi}>
              <Text variant="caption" color="textMuted">
                {k.label}
              </Text>
              <Text variant="bodyStrong" numeric>
                {k.value}
              </Text>
            </Card>
          ))}
        </View>
        {best && best.commission > 0 ? (
          <Text variant="caption" color="textMuted">
            {t('stats.best', { date: formatDate(best.date) })}
          </Text>
        ) : null}
        <Text variant="title">{t('stats.perDay')}</Text>
        <Card>
          {list.map((d) => (
            <View key={d.date} style={styles.dayRow}>
              <Text variant="caption" style={styles.dayLabel}>
                {formatDate(d.date)}
              </Text>
              <View style={styles.bars}>
                <View style={[styles.bar, { width: `${(d.cash_in.volume / max) * 100}%`, backgroundColor: colors.primary }]} />
                <View style={[styles.bar, { width: `${(d.cash_out.volume / max) * 100}%`, backgroundColor: colors.warning }]} />
              </View>
              <Text variant="caption" numeric style={styles.dayValue}>
                {money(d.commission)}
              </Text>
            </View>
          ))}
          <View style={styles.legend}>
            <View style={[styles.dot, { backgroundColor: colors.primary }]} />
            <Text variant="caption">{t('stats.deposits')}</Text>
            <View style={[styles.dot, { backgroundColor: colors.warning }]} />
            <Text variant="caption">{t('stats.withdrawals')}</Text>
            <Text variant="caption" color="textMuted">
              · {t('stats.commissions')} →
            </Text>
          </View>
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.md, paddingTop: space.sm, paddingBottom: space.xl },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  kpi: { width: '48.5%', gap: 4 },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.xs },
  dayLabel: { width: 74 },
  bars: { flex: 1, gap: 3 },
  bar: { height: 7, borderRadius: radius.sm, minWidth: 2 },
  dayValue: { width: 86, textAlign: 'right' },
  legend: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.md, flexWrap: 'wrap' },
  dot: { width: 10, height: 10, borderRadius: 5 }
});
