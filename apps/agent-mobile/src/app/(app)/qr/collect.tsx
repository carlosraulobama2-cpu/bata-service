import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ApiError, newIdempotencyKey } from '../../../api/client';
import { endpoints } from '../../../api/endpoints';
import type { AgentQr } from '../../../api/types';
import { AmountEntry } from '../../../components/AmountEntry';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { Header } from '../../../components/Header';
import { InfoRow } from '../../../components/InfoRow';
import { QrDisplay } from '../../../components/QrDisplay';
import { ResultView } from '../../../components/ResultView';
import { Screen } from '../../../components/Screen';
import { Text } from '../../../components/Text';
import { config } from '../../../config';
import { errorMessage } from '../../../features/errors';
import { useLimits } from '../../../features/queries';
import { useCountdown } from '../../../features/useCountdown';
import { useTheme } from '../../../theme/ThemeProvider';
import { radius, space } from '../../../theme/tokens';
import { formatCountdown, formatDate, formatTime, money } from '../../../utils/format';

/**
 * "Cobrar": the agent types an amount, the server creates a single-use QR
 * (and the pending QR payment), the customer pays it from Velynt. The
 * screen only turns to "Pagado" when the server says the payment is completed.
 */
export default function CollectScreen() {
  const { t } = useTranslation();
  const limits = useLimits();
  const [amount, setAmount] = useState(0);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qr, setQr] = useState<AgentQr | null>(null);
  // Same key for every retry of the same "Generar QR" (a lost response never creates two QRs).
  const keyRef = useRef<string | null>(null);
  const close = () => (router.canGoBack() ? router.back() : router.replace('/home'));

  const limit = limits.data?.limits.find((l) => l.operation_type === 'qr_payment');
  const amountError = useMemo(() => {
    if (!amount || !limit) return null;
    if (amount < limit.per_transaction.min) return t('cashIn.underMin', { amount: money(limit.per_transaction.min) });
    if (amount > limit.per_transaction.max) return t('cashIn.overPerTx', { amount: money(limit.per_transaction.max) });
    if (amount > limit.daily.remaining) return t('cashIn.overDaily', { amount: money(limit.daily.remaining) });
    return null;
  }, [amount, limit, t]);

  const create = async () => {
    keyRef.current ??= newIdempotencyKey();
    setCreating(true);
    setError(null);
    try {
      setQr(await endpoints.createCollectQr({ amount, key: keyRef.current }));
      keyRef.current = null;
    } catch (err) {
      // Network error: keep the key so the retry returns the same QR.
      if (!(err instanceof ApiError && err.isNetwork)) keyRef.current = null;
      setError(errorMessage(err, t));
    } finally {
      setCreating(false);
    }
  };

  if (qr) {
    return (
      <Following
        initial={qr}
        onClose={close}
        onRestart={() => {
          setQr(null);
          setAmount(0);
        }}
      />
    );
  }

  const hint = limit ? `${t('cashIn.perTxLimit', { amount: money(limit.per_transaction.max) })} · ${t('cashIn.remainingToday', { amount: money(limit.daily.remaining) })}` : undefined;
  return (
    <Screen
      header={<Header leading="close" onLeading={close} title={t('qr.collectAmountTitle')} />}
      footer={
        <>
          {error ? <Banner tone="danger">{error}</Banner> : null}
          <Button label={t('qr.collectCreate')} disabled={!amount || !!amountError} loading={creating} onPress={() => void create()} testID="collect-create" />
        </>
      }
      contentStyle={{ justifyContent: 'center' }}
    >
      <AmountEntry
        value={amount}
        onChange={(v) => {
          setAmount(v);
          keyRef.current = null; // a different amount is a different QR
        }}
        hint={hint}
        error={amountError}
      />
    </Screen>
  );
}

function Following({ initial, onClose, onRestart }: { initial: AgentQr; onClose: () => void; onRestart: () => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['qr', initial.qr_id],
    queryFn: () => endpoints.qr(initial.qr_id),
    initialData: initial,
    // Poll while the customer may still pay (docs: every 2 s).
    refetchInterval: (query) => {
      const d = query.state.data;
      return d && (d.status === 'active' || d.transaction?.status === 'processing') ? 2000 : false;
    }
  });
  const current = q.data ?? initial;
  const tx = current.transaction;
  const secondsLeft = useCountdown(current.status === 'active' ? current.expires_at : null);
  const [cancelling, setCancelling] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const paid = tx?.status === 'completed';
  const processing = tx?.status === 'processing';
  const waiting = current.status === 'active' && !processing;
  const terminal = !waiting && !processing;

  useEffect(() => {
    // Paid, expired or cancelled: balance, limits and history changed.
    if (terminal) void qc.invalidateQueries({ predicate: (query) => query.queryKey[0] !== 'qr' });
  }, [terminal, qc]);

  useEffect(() => {
    // The server expires the QR; refresh right when the timer ends.
    if (waiting && secondsLeft === 0) void q.refetch();
  }, [waiting, secondsLeft, q]);

  if (waiting || processing) {
    return (
      <Screen
        header={<Header leading="none" title={t('qr.collectTitle')} />}
        scroll
        footer={
          <>
            {config.devTools && waiting ? (
              <Button
                variant="secondary"
                label={t('qr.simulatePay')}
                loading={simulating}
                onPress={async () => {
                  setSimulating(true);
                  await endpoints.devPayQr(current.payload).catch(() => undefined);
                  await q.refetch();
                  setSimulating(false);
                }}
              />
            ) : null}
            <Button
              variant="danger"
              label={t('qr.collectCancel')}
              loading={cancelling}
              disabled={!waiting || !tx}
              onPress={async () => {
                if (!tx) return;
                setCancelling(true);
                setError(null);
                try {
                  await endpoints.cancel(tx.id);
                } catch (err) {
                  setError(errorMessage(err, t));
                }
                await q.refetch();
                setCancelling(false);
              }}
              testID="collect-cancel"
            />
          </>
        }
      >
        <View style={styles.showing}>
          <Text variant="label" color="textMuted" align="center">
            {processing ? t('qr.collectProcessing') : t('qr.collectWaiting')}
          </Text>
          <Text variant="display" numeric align="center">
            {money(current.amount ?? 0)}
          </Text>
          <QrDisplay value={current.payload} dimmed={processing} label={`${t('qr.collectTitle')} ${money(current.amount ?? 0)}`} />
          {processing ? (
            <ActivityIndicator color={colors.warning} size="large" />
          ) : (
            <View style={[styles.timer, { backgroundColor: colors.surface, borderColor: secondsLeft < 60 ? colors.warning : colors.border }]}>
              <ActivityIndicator color={colors.primary} />
              <Text variant="headline" numeric>
                {t('qr.collectExpiresIn', { time: formatCountdown(secondsLeft) })}
              </Text>
            </View>
          )}
          <Text variant="body" color="textMuted" align="center">
            {t('qr.collectShow')}
          </Text>
          {tx ? (
            <Text variant="caption" color="textMuted" align="center">
              {tx.reference}
            </Text>
          ) : null}
          {error ? <Banner tone="danger">{error}</Banner> : null}
        </View>
      </Screen>
    );
  }

  const title = paid
    ? t('qr.collectPaid')
    : current.status === 'expired' || tx?.status_reason === 'expired'
      ? t('qr.collectExpired')
      : tx?.status === 'cancelled'
        ? t('qr.collectCancelled')
        : t('qr.collectFailed');

  return (
    <Screen
      header={<Header leading="close" onLeading={onClose} />}
      scroll
      footer={
        <>
          <Button label={paid ? t('common.done') : t('qr.collectNew')} onPress={paid ? onClose : onRestart} testID="collect-done" />
          {paid ? <Button variant="secondary" label={t('qr.collectNew')} onPress={onRestart} /> : null}
          {paid && tx ? <Button variant="ghost" label={t('operations.receipt')} onPress={() => router.replace(`/transaction/${tx.id}`)} /> : null}
        </>
      }
    >
      <ResultView tone={paid ? 'success' : 'failure'} title={title} amount={money(current.amount ?? 0)} instruction={paid ? t('qr.collectPaidBody') : t('qr.collectNotPaidBody')} />
      {tx ? (
        <Card style={{ marginTop: space.xl }}>
          <InfoRow label="Transaction ID" value={tx.reference} strong />
          {paid ? <InfoRow label={t('common.customer')} value={tx.customer_masked ?? '—'} /> : null}
          <InfoRow label={t('common.date')} value={formatDate(tx.completed_at ?? tx.created_at)} />
          <InfoRow label={t('common.time')} value={formatTime(tx.completed_at ?? tx.created_at)} last />
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  showing: { alignItems: 'center', gap: space.lg, paddingTop: space.sm },
  timer: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.xl, paddingVertical: space.md, borderRadius: radius.pill, borderWidth: 1 }
});
