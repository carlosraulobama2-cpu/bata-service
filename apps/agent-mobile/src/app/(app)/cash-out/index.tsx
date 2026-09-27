import { router } from 'expo-router';
import { Keyboard as KeyboardIcon, ScanLine } from 'lucide-react-native';
import { useState } from 'react';
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
import { useBalance } from '../../../features/queries';
import { useCountdown } from '../../../features/useCountdown';
import { useOperation } from '../../../features/useOperation';
import { useTheme } from '../../../theme/ThemeProvider';
import { radius, space } from '../../../theme/tokens';
import { formatCountdown, formatDate, formatTime, groupDigits, money } from '../../../utils/format';

type Step = 'scan' | 'code' | 'review';

export default function CashOutScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const balance = useBalance();
  const [step, setStep] = useState<Step>(Platform.OS === 'web' ? 'code' : 'scan');
  const [code, setCode] = useState('');
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<WithdrawalPreview | null>(null);
  const secondsLeft = useCountdown(preview?.expires_at);

  const op = useOperation((key, stepUp) =>
    endpoints.cashOut({ withdrawalRequestId: preview!.withdrawal_request_id, amount: preview!.amount, key, stepUp, prompt: t('confirm.biometricPrompt') })
  );

  const resolve = async (value: { type: 'qr' | 'code'; value: string }) => {
    setResolving(true);
    setError(null);
    try {
      setPreview(await endpoints.resolveWithdrawal(value));
      setStep('review');
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setResolving(false);
    }
  };

  const close = () => (router.canGoBack() ? router.back() : router.replace('/home'));

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
    const ok = tx.status === 'completed';
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
        <ResultView
          tone={ok ? 'success' : 'failure'}
          title={ok ? t('cashOut.successTitle') : t(`status.${tx.status}`)}
          amount={money(tx.amount)}
          instruction={ok ? t('cashOut.handOver', { amount: money(tx.amount) }) : undefined}
        />
        <Card style={styles.receipt}>
          <InfoRow label="Transaction ID" value={tx.reference} strong />
          <InfoRow label={t('common.customer')} value={tx.customer_masked ?? '—'} />
          <InfoRow label={t('common.commission')} value={money(tx.commission)} />
          <InfoRow label={t('common.date')} value={formatDate(tx.completed_at ?? tx.created_at)} />
          <InfoRow label={t('common.time')} value={formatTime(tx.completed_at ?? tx.created_at)} last />
        </Card>
      </Screen>
    );
  }

  if (op.phase.kind === 'error') {
    return (
      <Screen header={<Header leading="close" onLeading={close} />} footer={<Button label={t('common.back')} onPress={() => { op.reset(); setPreview(null); setStep(Platform.OS === 'web' ? 'code' : 'scan'); }} />}>
        <ResultView tone="failure" title={t('status.failed')} instruction={op.phase.message} />
      </Screen>
    );
  }

  // ----- Review -----
  if (step === 'review' && preview) {
    const expired = secondsLeft <= 0;
    const floatAfter = balance.data ? balance.data.float.available + preview.amount : null;
    return (
      <Screen
        header={<Header leading="back" onLeading={() => { setPreview(null); setStep(Platform.OS === 'web' ? 'code' : 'scan'); }} title={t('cashOut.reviewTitle')} />}
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
          <InfoRow label={t('common.commission')} value={<Text variant="bodyStrong" color="success">{t('cashOut.youEarn', { amount: money(preview.commission) })}</Text>} />
          {floatAfter !== null ? <InfoRow label={t('cashOut.floatAfter')} value={money(floatAfter)} last /> : null}
        </Card>
        <View style={styles.expiry}>
          <Banner tone={expired ? 'danger' : secondsLeft < 60 ? 'warning' : 'info'}>{expired ? t('errors.QR_EXPIRED') : t('cashOut.expiresIn', { time: formatCountdown(secondsLeft) })}</Banner>
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

  // ----- Scan / type the code -----
  const codeDigits = code.replace(/\D/g, '');
  return (
    <Screen header={<Header leading="close" onLeading={close} title={t('cashOut.title')} />} scroll>
      <View style={styles.content}>
        {step === 'scan' ? (
          <>
            <Text variant="title">{t('cashOut.scanTitle')}</Text>
            <Text variant="body" color="textMuted">
              {t('cashOut.scanHint')}
            </Text>
            <Scanner paused={resolving} onCode={(data) => void resolve({ type: 'qr', value: data })} />
            <Button variant="secondary" icon={<KeyboardIcon size={20} color={colors.primary} />} label={t('cashOut.enterCodeInstead')} onPress={() => setStep('code')} />
          </>
        ) : (
          <>
            <Text variant="title">{t('cashOut.codeLabel')}</Text>
            <Text variant="body" color="textMuted">
              {t('cashOut.scanHint')}
            </Text>
            <TextInput
              value={groupDigits(codeDigits)}
              onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 9))}
              placeholder={t('cashOut.codePlaceholder')}
              placeholderTextColor={colors.textMuted}
              keyboardType="number-pad"
              autoFocus
              style={[styles.codeInput, { color: colors.text, backgroundColor: colors.surface, borderColor: error ? colors.danger : colors.border }]}
              accessibilityLabel={t('cashOut.codeLabel')}
              testID="withdrawal-code"
            />
            <Button label={t('common.continue')} onPress={() => void resolve({ type: 'code', value: codeDigits })} disabled={codeDigits.length !== 9} loading={resolving} testID="withdrawal-continue" />
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
  codeInput: { height: 72, borderWidth: 1.5, borderRadius: radius.md, textAlign: 'center', fontSize: 30, letterSpacing: 4, fontWeight: '600' },
  amountBlock: { paddingVertical: space.xxl, gap: space.xs },
  expiry: { marginTop: space.lg },
  receipt: { marginTop: space.xl },
  sheetSummary: { alignItems: 'center', gap: space.xs }
});
