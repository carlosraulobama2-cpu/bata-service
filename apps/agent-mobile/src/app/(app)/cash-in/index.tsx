import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { endpoints, maskedCustomer } from '../../../api/endpoints';
import type { Customer, TopupPreview } from '../../../api/types';
import { AmountEntry } from '../../../components/AmountEntry';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { Chips } from '../../../components/Chips';
import { ConfirmSheet } from '../../../components/ConfirmSheet';
import { Header } from '../../../components/Header';
import { InfoRow } from '../../../components/InfoRow';
import { ResultView } from '../../../components/ResultView';
import { Screen } from '../../../components/Screen';
import { Text } from '../../../components/Text';
import { errorMessage } from '../../../features/errors';
import { useLimits, useMe } from '../../../features/queries';
import { useCountdown } from '../../../features/useCountdown';
import { useOperation } from '../../../features/useOperation';
import { useTheme } from '../../../theme/ThemeProvider';
import { radius, space } from '../../../theme/tokens';
import { formatCountdown, formatDate, formatTime, groupDigits, money } from '../../../utils/format';

const PREFIX = '+240';
type Step = 'customer' | 'amount' | 'review';
type By = 'phone' | 'number';

/**
 * Deposit: the customer gives cash, the agent's float moves to the customer's Velynt wallet.
 * - Direct: phone number or customer number (BP-000182) -> confirm the masked name out loud ->
 *   amount -> PIN.
 * - Top-up QR (opened from the scanner with `?topup=<qr>`): the customer chose the amount in their
 *   app; the agent takes the cash and confirms with the PIN.
 */
export default function CashInScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const me = useMe();
  const limits = useLimits();
  const { topup: topupQr } = useLocalSearchParams<{ topup?: string }>();
  const [step, setStep] = useState<Step>(topupQr ? 'review' : 'customer');
  const [by, setBy] = useState<By>('phone');
  const [digits, setDigits] = useState('');
  const [number, setNumber] = useState('');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [topup, setTopup] = useState<TopupPreview | null>(null);
  const [amount, setAmount] = useState(0);
  const [looking, setLooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => (router.canGoBack() ? router.back() : router.replace('/home'));

  const who = by === 'phone' ? { phone: `${PREFIX}${digits}` } : { customerId: number.trim() };
  const op = useOperation((key, stepUp) =>
    topup
      ? endpoints.completeTopup({ topupId: topup.topup_id, key, stepUp, prompt: t('confirm.biometricPrompt') })
      : endpoints.cashIn({ customer: who, amount, key, stepUp, prompt: t('confirm.biometricPrompt') })
  );
  const topupSeconds = useCountdown(topup?.expires_at);

  useEffect(() => {
    if (!topupQr) return;
    setLooking(true);
    endpoints
      .resolveTopup(topupQr)
      .then((p) => {
        setTopup(p);
        setAmount(p.amount);
      })
      .catch((err) => setError(errorMessage(err, t)))
      .finally(() => setLooking(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topupQr]);

  const limit = limits.data?.limits.find((l) => l.operation_type === 'cash_in');
  const available = me.data?.float;

  // Client-side checks only guide the agent; the server re-validates everything.
  const amountError = useMemo(() => {
    if (!amount) return null;
    if (limit && amount > limit.daily.remaining) return limit.daily.remaining === 0 ? t('cashIn.dailyUsedUp') : t('cashIn.overDaily', { amount: money(limit.daily.remaining) });
    if (available !== undefined && amount > available) return t('cashIn.overFloat', { amount: money(available) });
    return null;
  }, [amount, limit, available, t]);

  const lookup = async () => {
    setLooking(true);
    setError(null);
    try {
      setCustomer(await endpoints.lookupCustomer(who));
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setLooking(false);
    }
  };

  const restart = () => {
    op.reset();
    setAmount(0);
    setDigits('');
    setNumber('');
    setCustomer(null);
    setTopup(null);
    setError(null);
    if (topupQr) router.setParams({ topup: '' });
    setStep('customer');
  };

  // ----- Outcome screens -----
  if (op.phase.kind === 'verifying') {
    return (
      <Screen header={<Header leading="none" title={t('cashIn.title')} />}>
        <ResultView tone="pending" title={t('cashOut.processingTitle')} instruction={t('cashIn.processingBody')}>
          <ActivityIndicator color={colors.warning} size="large" style={{ marginTop: space.xl }} />
        </ResultView>
      </Screen>
    );
  }

  if (op.phase.kind === 'done') {
    const tx = op.phase.tx;
    return (
      <Screen
        header={<Header leading="close" onLeading={close} />}
        scroll
        footer={
          <>
            <Button label={t('common.done')} onPress={close} testID="cashin-done" />
            <Button variant="ghost" label={t('operations.receipt')} onPress={() => router.replace(`/transaction/${tx.id}`)} />
          </>
        }
      >
        <ResultView tone="success" title={t('cashIn.successTitle')} amount={money(tx.amount)} instruction={t('cashIn.keepCash')} />
        <Card style={{ marginTop: space.xl }}>
          <InfoRow label={t('common.reference')} value={tx.reference} strong />
          <InfoRow label={t('common.customer')} value={tx.customer_masked ?? '—'} />
          <InfoRow label={t('common.commission')} value={money(tx.commission)} />
          <InfoRow label={t('common.date')} value={formatDate(tx.created_at)} />
          <InfoRow label={t('common.time')} value={formatTime(tx.created_at)} last />
        </Card>
      </Screen>
    );
  }

  if (op.phase.kind === 'error') {
    return (
      <Screen header={<Header leading="close" onLeading={close} />} footer={<Button label={t('common.back')} onPress={topup ? restart : () => { op.reset(); setStep('amount'); }} />}>
        <ResultView tone="failure" title={t('cashIn.notCompletedTitle')} instruction={`${op.phase.message} ${t('cashIn.notCompletedBody')}`} />
      </Screen>
    );
  }

  // ----- Who -----
  if (step === 'customer') {
    const ready = by === 'phone' ? digits.length === 9 : /\d/.test(number);
    return (
      <Screen
        header={<Header leading="close" onLeading={close} title={t('cashIn.title')} />}
        footer={
          customer ? (
            <>
              <Button label={t('cashIn.itIsThem')} onPress={() => setStep('amount')} testID="cashin-customer-confirm" />
              <Button variant="ghost" label={t('cashIn.notThem')} onPress={() => setCustomer(null)} />
            </>
          ) : (
            <Button label={t('common.continue')} disabled={!ready} loading={looking} onPress={() => void lookup()} testID="cashin-customer-continue" />
          )
        }
        scroll
      >
        <View style={styles.content}>
          <Text variant="title">{t('cashIn.customerTitle')}</Text>
          <Chips
            value={by}
            onChange={(v) => {
              setBy(v);
              setCustomer(null);
              setError(null);
            }}
            options={[
              { value: 'phone', label: t('cashIn.byPhone') },
              { value: 'number', label: t('cashIn.byNumber') }
            ]}
          />
          {by === 'phone' ? (
            <>
              <Text variant="label">{t('cashIn.customerPhoneLabel')}</Text>
              <View style={[styles.phone, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text variant="bodyStrong" style={[styles.prefix, { borderRightColor: colors.border }]}>
                  🇬🇶 {PREFIX}
                </Text>
                <TextInput
                  value={groupDigits(digits)}
                  onChangeText={(v) => {
                    setDigits(v.replace(/\D/g, '').slice(0, 9));
                    setCustomer(null);
                  }}
                  keyboardType="phone-pad"
                  autoFocus
                  placeholder="555 000 000"
                  placeholderTextColor={colors.textMuted}
                  style={[styles.phoneInput, { color: colors.text }]}
                  accessibilityLabel={t('cashIn.customerPhoneLabel')}
                  testID="cashin-phone"
                />
              </View>
            </>
          ) : (
            <>
              <Text variant="label">{t('cashIn.customerNumberLabel')}</Text>
              <TextInput
                value={number}
                onChangeText={(v) => {
                  setNumber(v.toUpperCase().slice(0, 20));
                  setCustomer(null);
                }}
                autoCapitalize="characters"
                autoCorrect={false}
                autoFocus
                placeholder="BP-000182"
                placeholderTextColor={colors.textMuted}
                style={[styles.textInput, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]}
                accessibilityLabel={t('cashIn.customerNumberLabel')}
                testID="cashin-number"
              />
            </>
          )}
          <Text variant="caption" color="textMuted">
            {t('cashIn.customerHint')}
          </Text>
          {customer ? (
            <Card>
              <Text variant="caption" color="textMuted">
                {t('cashIn.confirmName')}
              </Text>
              <Text variant="title">{customer.name}</Text>
              <Text variant="label" color="textMuted">
                {[customer.public_id, customer.phone_number].filter(Boolean).join(' · ')}
              </Text>
            </Card>
          ) : null}
          {error ? <Banner tone="danger">{error}</Banner> : null}
        </View>
      </Screen>
    );
  }

  // ----- How much -----
  if (step === 'amount') {
    const hint = limit ? t('cashIn.remainingToday', { amount: money(limit.daily.remaining) }) : undefined;
    return (
      <Screen
        header={<Header leading="back" onLeading={() => setStep('customer')} title={t('cashIn.amountTitle')} />}
        footer={<Button label={t('common.continue')} disabled={!amount || !!amountError} onPress={() => setStep('review')} testID="cashin-amount-continue" />}
        contentStyle={{ justifyContent: 'space-between' }}
      >
        <View style={{ gap: space.xs }}>
          <Text variant="bodyStrong" align="center">
            {maskedCustomer(customer)}
          </Text>
          {available !== undefined ? (
            <Text variant="caption" color="textMuted" align="center">
              {t('cashIn.available', { amount: money(available) })}
            </Text>
          ) : null}
        </View>
        <AmountEntry value={amount} onChange={setAmount} hint={hint} error={amountError} />
      </Screen>
    );
  }

  // ----- Review (direct or top-up QR) -----
  if (topupQr && !topup) {
    return (
      <Screen header={<Header leading="close" onLeading={close} title={t('cashIn.title')} />} footer={error ? <Button label={t('common.back')} onPress={close} /> : undefined}>
        {looking ? <ActivityIndicator color={colors.primary} size="large" style={{ marginTop: space.huge }} /> : null}
        {error ? <ResultView tone="failure" title={t('cashIn.topupInvalidTitle')} instruction={error} /> : null}
      </Screen>
    );
  }

  const shownCustomer = topup ? topup.customer_masked : maskedCustomer(customer);
  const expired = !!topup && topupSeconds <= 0;
  return (
    <Screen
      header={<Header leading={topup ? 'close' : 'back'} onLeading={topup ? close : () => setStep('amount')} title={t('cashIn.reviewTitle')} />}
      scroll
      footer={<Button label={t('cashIn.confirm')} onPress={op.open} disabled={expired || !!amountError} testID="cashin-confirm" />}
    >
      <View style={styles.amountBlock}>
        <Text variant="label" color="textMuted" align="center">
          {t('common.amount')}
        </Text>
        <Text variant="display" numeric align="center">
          {money(amount)}
        </Text>
        {topup ? (
          <Text variant="caption" color="textMuted" align="center">
            {t('cashIn.topupAmountFixed')}
          </Text>
        ) : null}
      </View>
      <Card>
        <InfoRow label={t('common.customer')} value={shownCustomer ?? '—'} strong />
        {available !== undefined ? <InfoRow label={t('cashOut.floatAfter')} value={money(available - amount)} last /> : null}
      </Card>
      <View style={{ marginTop: space.lg, gap: space.sm }}>
        {topup ? <Banner tone={expired ? 'danger' : 'info'}>{expired ? t('errors.topup_not_valid') : t('cashOut.expiresIn', { time: formatCountdown(topupSeconds) })}</Banner> : null}
        {amountError ? <Banner tone="danger">{amountError}</Banner> : null}
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
              {t('cashIn.title')} · {shownCustomer}
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

const styles = StyleSheet.create({
  content: { gap: space.md, paddingTop: space.sm },
  phone: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderRadius: radius.md, height: 60, overflow: 'hidden' },
  prefix: { paddingHorizontal: space.lg, borderRightWidth: 1, lineHeight: 60 },
  phoneInput: { flex: 1, paddingHorizontal: space.lg, fontSize: 20, letterSpacing: 1, height: '100%' },
  textInput: { height: 60, borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: space.lg, fontSize: 20, letterSpacing: 1 },
  amountBlock: { paddingVertical: space.xxl, gap: space.xs },
  sheetSummary: { alignItems: 'center', gap: space.xs }
});
