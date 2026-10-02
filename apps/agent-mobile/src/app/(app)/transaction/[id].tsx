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
import { config } from '../../../config';
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
        config.appName,
        `${t(`types.${tx.type}`)}: ${money(tx.amount)}`,
        `${t('common.reference')}: ${tx.reference}`,
        `${t('common.customer')}: ${tx.customer_masked ?? '—'}`,
        `${t('common.agent')}: ${tx.agent_code} · ${tx.agent_name}`,
        `${formatDateTime(tx.created_at)}`,
        `${t('common.status')}: ${t(`status.${tx.status}`)}`
      ].join('\n')
    });
  };

  return (
    <Screen
      header={<Header title={t('operations.detailTitle')} />}
      scroll
      footer={
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

          {/* Receipt: all identifiers selectable for support calls */}
          <Card>
            <InfoRow label={t('common.reference')} value={tx.reference} strong />
            <InfoRow label={t('common.type')} value={t(`types.${tx.type}`)} />
            <InfoRow label={t('common.amount')} value={money(tx.amount)} />
            {tx.fee > 0 ? <InfoRow label={t('cashOut.customerFee')} value={money(tx.fee)} /> : null}
            <InfoRow label={t('common.commission')} value={money(tx.commission)} />
            <InfoRow label={t('common.customer')} value={tx.customer_masked ?? '—'} />
            <InfoRow label={t('common.agent')} value={tx.agent_code} />
            <InfoRow label={t('common.date')} value={formatDate(tx.created_at)} />
            <InfoRow label={t('common.time')} value={formatTime(tx.created_at)} last />
          </Card>

          <View style={[styles.lock, { backgroundColor: colors.neutralSoft }]}>
            <Lock size={16} color={colors.textMuted} />
            <Text variant="caption" color="textMuted" style={{ flex: 1 }}>
              {t('operations.cannotEdit')}
            </Text>
          </View>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.lg, paddingTop: space.md },
  top: { alignItems: 'center', gap: space.sm, paddingVertical: space.lg },
  lock: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.md }
});
