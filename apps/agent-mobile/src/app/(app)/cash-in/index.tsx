import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../../api/endpoints';
import type { Transaction } from '../../../api/types';
import { AmountEntry } from '../../../components/AmountEntry';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { ConfirmSheet } from '../../../components/ConfirmSheet';
import { Header } from '../../../components/Header';
import { InfoRow } from '../../../components/InfoRow';
import { ResultView } from '../../../components/ResultView';
import { Screen } from '../../../components/Screen';
import { Text } from '../../../components/Text';
import { config } from '../../../config';
import { errorMessage } from '../../../features/errors';
import { useBalance, useLimits, useTransaction } from '../../../features/queries';
import { useCountdown } from '../../../features/useCountdown';
import { useOperation } from '../../../features/useOperation';
import { useTheme } from '../../../theme/ThemeProvider';
import { radius, space } from '../../../theme/tokens';
import { formatCountdown, formatDate, formatTime, groupDigits, money } from '../../../utils/format';

const PREFIX = '+240';
type Step = 'customer' | 'amount' | 'review';

export default function CashInScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const balance = useBalance();
  const limits = useLimits();
  const [step, setStep] = useState<Step>('customer');
  const [digits, setDigits] = useState('');
  const [amount, setAmount] = useState(0);

  const phone = `${PREFIX}${digits}`;
  const op = useOperation((key, stepUp) => endpoints.cashIn({ phone, amount, key, stepUp, prompt: t('confirm.biometricPrompt') }));
  const close = () => (router.canGoBack() ? router.back() : router.replace('/home'));

  const limit = limits.data?.limits.find((l) => l.operation_type === 'cash_in');
  const available = balance.data?.float.available;

  // Client-side checks only guide the agent; the server re-validates everything.
  const amountError = useMemo(() => {
    if (!amount) return null;
    if (limit && amount < limit.per_transaction.min) return t('cashIn.underMin', { amount: money(limit.per_transaction.min) });
    if (limit && amount > limit.per_transaction.max) return t('cashIn.overPerTx', { amount: money(limit.per_transaction.max) });
    if (limit && amount > limit.daily.remaining) return limit.daily.remaining === 0 ? t('cashIn.dailyUsedUp') : t('cashIn.overDaily', { amount: money(limit.daily.remaining) });
    if (available !== undefined && amount > available) return t('cashIn.overFloat', { amount: money(available) });
    return null;
  }, [amount, limit, available, t]);

  if (op.phase.kind === 'done') return <Following tx={op.phase.tx} onClose={close} onRestart={() => { op.reset(); setAmount(0); setDigits(''); setStep('customer'); }} />;

  if (op.phase.kind === 'verifying') {
    return (
      <Screen header={<Header leading="none" title={t('cashIn.title')} />}>
        <ResultView tone="pending" title={t('cashOut.processingTitle')}>
          <ActivityIndicator color={colors.warning} size="large" style={{ marginTop: space.xl }} />
        </ResultView>
      </Screen>
    );
  }

  if (op.phase.kind === 'error') {
    return (
      <Screen header={<Header leading="close" onLeading={close} />} footer={<Button label={t('common.back')} onPress={() => { op.reset(); setStep('amount'); }} />}>
        <ResultView tone="failure" title={t('status.failed')} instruction={op.phase.message} />
      </Screen>
    );
  }

  if (step === 'customer') {
    const valid = digits.length === 9;
    return (
      <Screen
        header={<Header leading="close" onLeading={close} title={t('cashIn.title')} />}
        footer={<Button label={t('common.continue')} disabled={!valid} onPress={() => setStep('amount')} testID="cashin-customer-continue" />}
        scroll
      >
        <View style={styles.content}>
          <Text variant="title">{t('cashIn.customerTitle')}</Text>
          <Text variant="label">{t('cashIn.customerPhoneLabel')}</Text>
          <View style={[styles.phone, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text variant="bodyStrong" style={[styles.prefix, { borderRightColor: colors.border }]}>
              🇬🇶 {PREFIX}
            </Text>
            <TextInput
              value={groupDigits(digits)}
              onChangeText={(v) => setDigits(v.replace(/\D/g, '').slice(0, 9))}
              keyboardType="phone-pad"
              autoFocus
              placeholder="555 000 000"
              placeholderTextColor={colors.textMuted}
              style={[styles.phoneInput, { color: colors.text }]}
              accessibilityLabel={t('cashIn.customerPhoneLabel')}
              testID="cashin-phone"
            />
          </View>
          <Text variant="caption" color="textMuted">
            {t('cashIn.customerHint')}
          </Text>
        </View>
      </Screen>
    );
  }

  if (step === 'amount') {
    const hint = limit ? `${t('cashIn.perTxLimit', { amount: money(limit.per_transaction.max) })} · ${t('cashIn.remainingToday', { amount: money(limit.daily.remaining) })}` : undefined;
    return (
      <Screen
        header={<Header leading="back" onLeading={() => setStep('customer')} title={t('cashIn.amountTitle')} />}
        footer={<Button label={t('common.continue')} disabled={!amount || !!amountError} onPress={() => setStep('review')} testID="cashin-amount-continue" />}
        contentStyle={{ justifyContent: 'space-between' }}
      >
        {available !== undefined ? (
          <Text variant="caption" color="textMuted" align="center">
            {t('cashIn.available', { amount: money(available) })}
          </Text>
        ) : null}
        <AmountEntry value={amount} onChange={setAmount} hint={hint} error={amountError} />
      </Screen>
    );
  }

  return (
    <Screen
      header={<Header leading="back" onLeading={() => setStep('amount')} title={t('cashIn.reviewTitle')} />}
      scroll
      footer={<Button label={t('cashIn.confirm')} onPress={op.open} testID="cashin-confirm" />}
    >
      <View style={styles.amountBlock}>
        <Text variant="label" color="textMuted" align="center">
          {t('common.amount')}
        </Text>
        <Text variant="display" numeric align="center">
          {money(amount)}
        </Text>
      </View>
      <Card>
        <InfoRow label={t('common.customer')} value={`****${digits.slice(-4)}`} strong />
        {available !== undefined ? <InfoRow label={t('cashOut.floatAfter')} value={money(available - amount)} last /> : null}
      </Card>
      <View style={{ marginTop: space.lg }}>
        <Banner tone="info">{t('cashIn.receiveCash', { amount: money(amount) })}</Banner>
      </View>
      <ConfirmSheet
        visible={op.phase.kind === 'confirming'}
        busy={op.phase.kind === 'confirming' && op.phase.busy}
        error={op.phase.kind === 'confirming' ? op.phase.error : null}
        onSubmit={op.submit}
        onClose={op.closeSheet}
        summary={
          <View style={styles.sheetSummary}>
            <Text variant="label" color="textMuted">
              {t('cashIn.title')} · ****{digits.slice(-4)}
            </Text>
            <Text variant="amount" numeric>
              {money(amount)}
            </Text>
          </View>
        }
      />
    </Screen>
  );
}

/** After creation: follow the operation until the customer answers. */
function Following({ tx: initial, onClose, onRestart }: { tx: Transaction; onClose: () => void; onRestart: () => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const q = useTransaction(initial.id);
  const tx = q.data ?? initial;
  const secondsLeft = useCountdown(tx.status === 'pending' ? tx.expires_at : null);
  const [cancelling, setCancelling] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const terminal = tx.status !== 'pending' && tx.status !== 'processing';

  useEffect(() => {
    // The deposit finished (confirmed, rejected, expired or cancelled): balances, limits and history changed.
    if (terminal) void qc.invalidateQueries();
  }, [terminal, qc]);

  useEffect(() => {
    // The server expires the request; nudge a refresh right after the timer ends.
    if (tx.status === 'pending' && secondsLeft === 0) void q.refetch();
  }, [secondsLeft, tx.status, q]);

  if (tx.status === 'pending' || tx.status === 'processing') {
    return (
      <Screen
        header={<Header leading="none" title={t('cashIn.title')} />}
        footer={
          <>
            {config.devTools ? (
              <Button
                variant="secondary"
                label={t('cashIn.simulateConfirm')}
                loading={simulating}
                onPress={async () => {
                  setSimulating(true);
                  await endpoints.devConfirmDeposit(tx.id).catch(() => undefined);
                  await q.refetch();
                  setSimulating(false);
                }}
              />
            ) : null}
            <Button
              variant="danger"
              label={t('cashIn.cancelDeposit')}
              loading={cancelling}
              disabled={tx.status !== 'pending'}
              onPress={async () => {
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
            />
          </>
        }
      >
        <ResultView tone="pending" title={t('cashIn.waitingTitle')} amount={money(tx.amount)} instruction={t('cashIn.waitingBody')}>
          <View style={[styles.timer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <ActivityIndicator color={colors.primary} />
            <Text variant="headline" numeric>
              {t('cashIn.timeLeft', { time: formatCountdown(secondsLeft) })}
            </Text>
          </View>
          <Text variant="caption" color="textMuted">
            {t('common.customer')} {tx.customer_masked} · {tx.reference}
          </Text>
          {error ? <Banner tone="danger">{error}</Banner> : null}
        </ResultView>
      </Screen>
    );
  }

  const ok = tx.status === 'completed';
  const title = ok
    ? t('cashIn.successTitle')
    : tx.status_reason === 'expired'
      ? t('cashIn.expiredTitle')
      : tx.status_reason === 'customer_rejected'
        ? t('cashIn.rejectedTitle')
        : tx.status === 'cancelled'
          ? t('cashIn.cancelledTitle')
          : t(`status.${tx.status}`);

  return (
    <Screen
      header={<Header leading="close" onLeading={onClose} />}
      scroll
      footer={
        <>
          <Button label={ok ? t('common.done') : t('common.newOperation')} onPress={ok ? onClose : onRestart} testID="cashin-done" />
          {ok ? <Button variant="ghost" label={t('operations.receipt')} onPress={() => router.replace(`/transaction/${tx.id}`)} /> : null}
        </>
      }
    >
      <ResultView tone={ok ? 'success' : 'failure'} title={title} amount={money(tx.amount)} instruction={ok ? t('cashIn.keepCash') : t('cashIn.notCompletedBody')} />
      <Card style={{ marginTop: space.xl }}>
        <InfoRow label="Transaction ID" value={tx.reference} strong />
        <InfoRow label={t('common.customer')} value={tx.customer_masked ?? '—'} />
        {ok ? <InfoRow label={t('common.commission')} value={money(tx.commission)} /> : null}
        <InfoRow label={t('common.date')} value={formatDate(tx.completed_at ?? tx.created_at)} />
        <InfoRow label={t('common.time')} value={formatTime(tx.completed_at ?? tx.created_at)} last />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.md, paddingTop: space.sm },
  phone: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderRadius: radius.md, height: 60, overflow: 'hidden' },
  prefix: { paddingHorizontal: space.lg, borderRightWidth: 1, lineHeight: 60 },
  phoneInput: { flex: 1, paddingHorizontal: space.lg, fontSize: 20, letterSpacing: 1, height: '100%' },
  amountBlock: { paddingVertical: space.xxl, gap: space.xs },
  sheetSummary: { alignItems: 'center', gap: space.xs },
  timer: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.xl, paddingVertical: space.md, borderRadius: radius.pill, borderWidth: 1, marginTop: space.md }
});
