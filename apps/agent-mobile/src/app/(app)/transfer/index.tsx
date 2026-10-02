import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ApiError, newIdempotencyKey } from '../../../api/client';
import { endpoints } from '../../../api/endpoints';
import type { FloatMovement, StepUp } from '../../../api/types';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { ConfirmSheet } from '../../../components/ConfirmSheet';
import { Header } from '../../../components/Header';
import { InfoRow } from '../../../components/InfoRow';
import { MoneyInput } from '../../../components/MoneyInput';
import { ResultView } from '../../../components/ResultView';
import { Screen } from '../../../components/Screen';
import { Text } from '../../../components/Text';
import { errorMessage } from '../../../features/errors';
import { useMe } from '../../../features/queries';
import { useTheme } from '../../../theme/ThemeProvider';
import { radius, space } from '../../../theme/tokens';
import { money } from '../../../utils/format';

type Receiver = { code: string; business_name: string; city: string };

/** Pass float to another agent: find by code, confirm the name, amount, PIN. */
export default function TransferScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const me = useMe();
  const [code, setCode] = useState('');
  const [receiver, setReceiver] = useState<Receiver | null>(null);
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<{ busy: boolean; error: string | null } | null>(null);
  const [done, setDone] = useState<FloatMovement | null>(null);
  // One key per transfer, reused if the agent retries after a network error: it moves once.
  const key = useRef<string | null>(null);
  const close = () => (router.canGoBack() ? router.back() : router.replace('/home'));
  const float = me.data?.float ?? 0;

  const find = async () => {
    setBusy(true);
    setError(null);
    try {
      setReceiver(await endpoints.lookupAgent(code.trim()));
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (stepUp: StepUp) => {
    if (!receiver) return;
    key.current ??= newIdempotencyKey();
    setSheet({ busy: true, error: null });
    try {
      const result = await endpoints.transferToAgent({ toAgentCode: receiver.code, amount, reason: reason.trim(), key: key.current, stepUp, prompt: t('confirm.biometricPrompt') });
      setSheet(null);
      setDone(result.movement);
      void qc.invalidateQueries();
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'wrong_pin' || err.code === 'biometric_cancelled' || err.isNetwork)) {
        setSheet({ busy: false, error: err.code === 'biometric_cancelled' ? null : errorMessage(err, t) });
        return;
      }
      key.current = null;
      setSheet(null);
      setError(errorMessage(err, t));
    }
  };

  if (done && receiver) {
    return (
      <Screen header={<Header leading="close" onLeading={close} />} footer={<Button label={t('common.done')} onPress={close} />}>
        <ResultView tone="success" title={t('transfer.done')} amount={money(done.amount)} instruction={t('transfer.doneBody', { amount: money(done.amount), name: receiver.business_name, code: done.code })} />
      </Screen>
    );
  }

  const input = [styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }];
  return (
    <Screen header={<Header leading="close" onLeading={close} title={t('transfer.title')} />} scroll>
      <View style={styles.content}>
        <Text variant="body" color="textMuted">
          {t('transfer.intro')}
        </Text>
        <Text variant="label">{t('transfer.code')}</Text>
        <TextInput
          value={code}
          onChangeText={(v) => {
            setCode(v.toUpperCase());
            setReceiver(null);
          }}
          autoCapitalize="characters"
          placeholder="AG-000123"
          placeholderTextColor={colors.textMuted}
          style={input}
          testID="transfer-code"
        />
        {!receiver ? <Button variant="secondary" label={t('transfer.find')} onPress={() => void find()} disabled={code.replace(/\D/g, '').length < 1} loading={busy} testID="transfer-find" /> : null}
        {receiver ? (
          <>
            <Banner tone="info">{t('transfer.confirmName', { name: receiver.business_name, city: receiver.city })}</Banner>
            <Text variant="label">{t('transfer.amount')}</Text>
            <MoneyInput value={amount} onChange={setAmount} testID="transfer-amount" />
            <Text variant="caption" color={amount > float ? 'danger' : 'textMuted'}>
              {t('floatRequest.current')}: {money(float)}
            </Text>
            <Text variant="label">{t('transfer.reason')}</Text>
            <TextInput value={reason} onChangeText={setReason} maxLength={280} style={input} />
            <Button label={t('transfer.review')} onPress={() => setSheet({ busy: false, error: null })} disabled={!amount || amount > float} testID="transfer-review" />
          </>
        ) : null}
        {error ? <Banner tone="danger">{error}</Banner> : null}
      </View>
      <ConfirmSheet
        visible={!!sheet}
        busy={!!sheet?.busy}
        error={sheet?.error ?? null}
        onSubmit={(stepUp) => void submit(stepUp)}
        onClose={() => !sheet?.busy && setSheet(null)}
        summary={
          receiver ? (
            <Card>
              <InfoRow label={t('transfer.title')} value={receiver.business_name} />
              <InfoRow label={t('transfer.code')} value={receiver.code} />
              <InfoRow label={t('transfer.amount')} value={money(amount)} strong last />
            </Card>
          ) : null
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.md, paddingTop: space.sm, paddingBottom: space.xl },
  row: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  input: { minHeight: 52, borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: space.lg, fontSize: 17 }
});
