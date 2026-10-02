import { router, useLocalSearchParams } from 'expo-router';
import { Keyboard as KeyboardIcon, ScanLine } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../../api/endpoints';
import type { WithdrawalPreview } from '../../../api/types';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { ConfirmSheet } from '../../../components/ConfirmSheet';
import { Header } from '../../../components/Header';
import { InfoRow } from '../../../components/InfoRow';
import { ResultView } from '../../../components/ResultView';
import { Scanner } from '../../../components/Scanner';
import { Screen } from '../../../components/Screen';
import { Text } from '../../../components/Text';
import { errorMessage } from '../../../features/errors';
import { useMe } from '../../../features/queries';
import { useCountdown } from '../../../features/useCountdown';
import { useOperation } from '../../../features/useOperation';
import { useTheme } from '../../../theme/ThemeProvider';
import { radius, space } from '../../../theme/tokens';
import { formatCountdown, formatDate, formatTime, groupDigits, money } from '../../../utils/format';

const PREFIX = '+240';
const CODE_LENGTH = 6;
type Step = 'scan' | 'code' | 'review';

/**
 * Withdrawal: the customer asked for cash in their Velynt app and got a QR and a 6-digit code.
 * The agent scans the QR (or types the customer's phone + code), checks, confirms with the PIN and
 * only then hands over the cash.
 */
export default function CashOutScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const me = useMe();
  const firstStep: Step = Platform.OS === 'web' ? 'code' : 'scan';
  const [step, setStep] = useState<Step>(firstStep);
  const [digits, setDigits] = useState('');
  const [code, setCode] = useState('');
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<WithdrawalPreview | null>(null);
  const secondsLeft = useCountdown(preview?.expires_at);
  // Opened from the unified scanner with a withdrawal QR: go straight to the review.
  const { qr } = useLocalSearchParams<{ qr?: string }>();

  const op = useOperation((key, stepUp) => endpoints.cashOut({ cashoutId: preview!.cashout_id, code: preview!.code, key, stepUp, prompt: t('confirm.biometricPrompt') }));

  const resolve = async (by: { qr: string } | { phone: string; code: string }) => {
    setResolving(true);
    setError(null);
    try {
      setPreview(await endpoints.resolveWithdrawal(by));
      setStep('review');
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setResolving(false);
    }
  };

  const close = () => (router.canGoBack() ? router.back() : router.replace('/home'));
  const startOver = () => {
    op.reset();
    setPreview(null);
    setCode('');
    setStep(firstStep);
  };

  useEffect(() => {
    if (qr) void resolve({ qr });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qr]);

  // ----- Outcome screens -----
  if (op.phase.kind === 'verifying') {
    return (
      <Screen header={<Header leading="none" title={t('cashOut.title')} />}>
        <ResultView tone="pending" title={t('cashOut.processingTitle')} instruction={t('cashOut.processingBody')}>
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
            <Button label={t('common.done')} onPress={close} testID="cashout-done" />
            <Button variant="ghost" label={t('operations.receipt')} onPress={() => router.replace(`/transaction/${tx.id}`)} />
          </>
        }
      >
        <ResultView tone="success" title={t('cashOut.successTitle')} amount={money(tx.amount)} instruction={t('cashOut.handOver', { amount: money(tx.amount) })} />
        <Card style={styles.receipt}>
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
      <Screen header={<Header leading="close" onLeading={close} />} footer={<Button label={t('common.back')} onPress={startOver} />}>
        <ResultView tone="failure" title={t('cashOut.notCompletedTitle')} instruction={`${op.phase.message} ${t('cashOut.dontHandOver')}`} />
      </Screen>
    );
  }

  // ----- Review -----
  if (step === 'review' && preview) {
    const expired = secondsLeft <= 0;
    const floatAfter = me.data ? me.data.float + preview.amount : null;
    return (
      <Screen
        header={<Header leading="back" onLeading={startOver} title={t('cashOut.reviewTitle')} />}
        scroll
        footer={<Button label={t('cashOut.confirm')} onPress={op.open} disabled={expired} testID="cashout-confirm" />}
      >
        <View style={styles.amountBlock}>
          <Text variant="label" color="textMuted" align="center">
            {t('cashOut.amountToDeliver')}
          </Text>
          <Text variant="display" numeric align="center">
            {money(preview.amount)}
          </Text>
          <Text variant="caption" color="textMuted" align="center">
            {t('cashOut.amountLocked')}
          </Text>
        </View>
        <Card>
          <InfoRow label={t('common.customer')} value={preview.customer_masked} strong />
          {preview.fee > 0 ? <InfoRow label={t('cashOut.customerFee')} value={money(preview.fee)} /> : null}
          {floatAfter !== null ? <InfoRow label={t('cashOut.floatAfter')} value={money(floatAfter)} last /> : null}
        </Card>
        <View style={styles.expiry}>
          <Banner tone={expired ? 'danger' : secondsLeft < 60 ? 'warning' : 'info'}>{expired ? t('errors.cashout_not_valid') : t('cashOut.expiresIn', { time: formatCountdown(secondsLeft) })}</Banner>
        </View>
        <Text variant="caption" color="textMuted" align="center" style={{ marginTop: space.md }}>
          {t('cashOut.dontHandOverYet')}
        </Text>
        <ConfirmSheet
          visible={op.phase.kind === 'confirming'}
          busy={op.phase.kind === 'confirming' && op.phase.busy}
          error={op.phase.kind === 'confirming' ? op.phase.error : null}
          onSubmit={op.submit}
          onClose={op.closeSheet}
          summary={
            <View style={styles.sheetSummary}>
              <Text variant="label" color="textMuted">
                {t('cashOut.title')} · {preview.customer_masked}
              </Text>
              <Text variant="amount" numeric>
                {money(preview.amount)}
              </Text>
            </View>
          }
        />
      </Screen>
    );
  }

  // ----- Scan / type phone + code -----
  const codeDigits = code.replace(/\D/g, '');
  const canResolve = digits.length === 9 && codeDigits.length === CODE_LENGTH;
  const input = [styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: error ? colors.danger : colors.border }];
  return (
    <Screen header={<Header leading="close" onLeading={close} title={t('cashOut.title')} />} scroll>
      <View style={styles.content}>
        {step === 'scan' ? (
          <>
            <Text variant="title">{t('cashOut.scanTitle')}</Text>
            <Text variant="body" color="textMuted">
              {t('cashOut.scanHint')}
            </Text>
            <Scanner paused={resolving} onCode={(data) => void resolve({ qr: data })} />
            <Button variant="secondary" icon={<KeyboardIcon size={20} color={colors.primary} />} label={t('cashOut.enterCodeInstead')} onPress={() => setStep('code')} />
          </>
        ) : (
          <>
            <Text variant="title">{t('cashOut.codeTitle')}</Text>
            <Text variant="body" color="textMuted">
              {t('cashOut.codeHint')}
            </Text>
            <Text variant="label">{t('cashIn.customerPhoneLabel')}</Text>
            <View style={[styles.phone, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={[styles.prefix, { borderRightColor: colors.border }]}>
                <Text variant="bodyStrong">🇬🇶 {PREFIX}</Text>
              </View>
              <TextInput
                value={groupDigits(digits)}
                onChangeText={(v) => setDigits(v.replace(/\D/g, '').slice(0, 9))}
                keyboardType="phone-pad"
                autoFocus
                placeholder="555 000 000"
                placeholderTextColor={colors.textMuted}
                style={[styles.phoneInput, { color: colors.text }]}
                accessibilityLabel={t('cashIn.customerPhoneLabel')}
                testID="withdrawal-phone"
              />
            </View>
            <Text variant="label">{t('cashOut.codeLabel')}</Text>
            <TextInput
              value={groupDigits(codeDigits)}
              onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, CODE_LENGTH))}
              placeholder="000 000"
              placeholderTextColor={colors.textMuted}
              keyboardType="number-pad"
              style={input}
              accessibilityLabel={t('cashOut.codeLabel')}
              testID="withdrawal-code"
            />
            <Button label={t('common.continue')} onPress={() => void resolve({ phone: `${PREFIX}${digits}`, code: codeDigits })} disabled={!canResolve} loading={resolving} testID="withdrawal-continue" />
            {Platform.OS !== 'web' ? <Button variant="ghost" icon={<ScanLine size={20} color={colors.primary} />} label={t('cashOut.scanInstead')} onPress={() => setStep('scan')} /> : null}
          </>
        )}
        {resolving ? <Text variant="label" color="textMuted" align="center">{t('cashOut.checking')}</Text> : null}
        {error ? <Banner tone="danger">{error}</Banner> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.lg, paddingTop: space.sm },
  phone: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderRadius: radius.md, height: 60, overflow: 'hidden' },
  prefix: { paddingHorizontal: space.lg, borderRightWidth: 1, height: '100%', justifyContent: 'center' },
  phoneInput: { flex: 1, paddingHorizontal: space.lg, fontSize: 20, letterSpacing: 1, height: '100%' },
  input: { height: 72, borderWidth: 1.5, borderRadius: radius.md, textAlign: 'center', fontSize: 30, letterSpacing: 4, fontWeight: '600' },
  amountBlock: { paddingVertical: space.xxl, gap: space.xs },
  expiry: { marginTop: space.lg },
  receipt: { marginTop: space.xl },
  sheetSummary: { alignItems: 'center', gap: space.xs }
});
