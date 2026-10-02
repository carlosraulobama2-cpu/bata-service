import { router, useLocalSearchParams } from 'expo-router';
import { Lock } from 'lucide-react-native';
import { Share, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { Header } from '../../../components/Header';
import { InfoRow } from '../../../components/InfoRow';
import { Screen } from '../../../components/Screen';
import { StatusBadge } from '../../../components/StatusBadge';
import { ErrorState, Skeleton } from '../../../components/States';
import { Text } from '../../../components/Text';
import { useTransaction } from '../../../features/queries';
import { useTheme } from '../../../theme/ThemeProvider';
import { radius, space } from '../../../theme/tokens';
import { formatDate, formatDateTime, formatTime, money } from '../../../utils/format';

export default function TransactionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const q = useTransaction(id);
  const tx = q.data;

  const share = () => {
    if (!tx) return;
    // Receipt text keeps the customer masked.
    void Share.share({
      message: [
        'VELYNT SERVICES',
        `${t(`types.${tx.type}`)}: ${money(tx.amount)}`,
        `Transaction ID: ${tx.reference}`,
        `${t('common.customer')}: ${tx.customer_masked ?? '—'}`,
        `${t('common.agent')}: ${tx.agent_code}`,
        `${formatDateTime(tx.completed_at ?? tx.created_at)}`,
        `${t('common.status')}: ${t(`status.${tx.status}`)}`
      ].join('\n')
    });
  };

  return (
    <Screen header={<Header title={t('operations.detailTitle')} />} scroll footer={
        tx ? (
          <>
            <Button variant="secondary" label={t('operations.receipt')} onPress={share} />
            <Button variant="ghost" label={t('support.report')} onPress={() => router.push({ pathname: '/help', params: { tx: tx.id } })} testID="tx-report-problem" />
          </>
        ) : undefined
      }
    >
      {q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
      {!tx && q.isLoading ? (
        <View style={{ gap: space.md, paddingTop: space.xl }}>
          <Skeleton height={40} width="60%" />
          <Skeleton height={200} />
        </View>
      ) : null}
      {tx ? (
        <View style={styles.content}>
          <View style={styles.top}>
            <Text variant="label" color="textMuted">
              {t(`types.${tx.type}`)}
            </Text>
            <Text variant="display" numeric>
              {money(tx.amount)}
            </Text>
            <View style={{ alignItems: 'center' }}>
              <StatusBadge status={tx.status} />
            </View>
          </View>

          {/* Receipt: perforated look, all identifiers selectable for support calls */}
          <Card>
            <InfoRow label="Transaction ID" value={tx.reference} strong />
            <InfoRow label={t('common.type')} value={t(`types.${tx.type}`)} />
            <InfoRow label={t('common.amount')} value={money(tx.amount)} />
            <InfoRow label={t('common.commission')} value={money(tx.commission)} />
            <InfoRow label={t('common.customer')} value={tx.customer_masked ?? '—'} />
            <InfoRow label={t('common.agent')} value={tx.agent_code} />
            <InfoRow label={t('common.method')} value={tx.method.toUpperCase()} />
            <InfoRow label={t('common.date')} value={formatDate(tx.created_at)} />
            <InfoRow label={t('common.time')} value={formatTime(tx.created_at)} last />
          </Card>

          {tx.events?.length ? (
            <Card>
              <Text variant="overline" color="textMuted" style={{ marginBottom: space.md }}>
                {t('operations.timeline')}
              </Text>
              {tx.events.map((e, i) => (
                <View key={`${e.at}-${i}`} style={styles.event}>
                  <View style={styles.rail}>
                    <View style={[styles.dot, { backgroundColor: i === tx.events!.length - 1 ? colors.primary : colors.border }]} />
                    {i < tx.events!.length - 1 ? <View style={[styles.line, { backgroundColor: colors.border }]} /> : null}
                  </View>
                  <View style={styles.eventText}>
                    <Text variant="bodyStrong">{t(`status.${e.status}`, { defaultValue: e.status })}</Text>
                    <Text variant="caption" color="textMuted">
                      {formatDateTime(e.at)}
                    </Text>
                  </View>
                </View>
              ))}
            </Card>
          ) : null}

          {tx.status === 'completed' ? (
            <View style={[styles.lock, { backgroundColor: colors.neutralSoft }]}>
              <Lock size={16} color={colors.textMuted} />
              <Text variant="caption" color="textMuted" style={{ flex: 1 }}>
                {t('operations.cannotEdit')}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.lg, paddingTop: space.md },
  top: { alignItems: 'center', gap: space.sm, paddingVertical: space.lg },
  event: { flexDirection: 'row', gap: space.md },
  rail: { alignItems: 'center', width: 12 },
  dot: { width: 12, height: 12, borderRadius: 6, marginTop: 5 },
  line: { width: 2, flex: 1, minHeight: 28 },
  eventText: { paddingBottom: space.md, gap: 2 },
  lock: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md }
});
