import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../../api/endpoints';
import type { FloatRequest } from '../../../api/types';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { Header } from '../../../components/Header';
import { InfoRow } from '../../../components/InfoRow';
import { MoneyInput } from '../../../components/MoneyInput';
import { Screen } from '../../../components/Screen';
import { EmptyState } from '../../../components/States';
import { Text } from '../../../components/Text';
import { errorMessage } from '../../../features/errors';
import { useTheme } from '../../../theme/ThemeProvider';
import { radius, space } from '../../../theme/tokens';
import { formatDateTime, money } from '../../../utils/format';

/** "Solicitar saldo": ask Velynt for float, with the payment reference and a photo of the slip. */
export default function FloatRequestScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['float-requests'], queryFn: endpoints.floatRequests });
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState(t('floatRequest.reasonDefault'));
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const close = () => (router.canGoBack() ? router.back() : router.replace('/home'));
  const room = list.data ? Math.max(0, list.data.max_float - list.data.float) : 0;
  const pending = list.data?.requests.find((r) => r.status === 'pending');

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['float-requests'] }), qc.invalidateQueries({ queryKey: ['me'] })]);
  const run = async <T,>(action: () => Promise<T>, done: string | ((result: T) => string)) => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await action();
      setMessage({ tone: 'success', text: typeof done === 'string' ? done : done(result) });
      await refresh();
    } catch (err) {
      setMessage({ tone: 'danger', text: errorMessage(err, t) });
    } finally {
      setBusy(false);
    }
  };
  const addProof = async (request: FloatRequest) => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, exif: false });
    if (picked.canceled || !picked.assets[0]) return;
    await run(() => endpoints.uploadFloatProof(request.id, picked.assets[0]!), t('floatRequest.proofAdded'));
  };

  const input = [styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }];
  return (
    <Screen header={<Header leading="close" onLeading={close} title={t('floatRequest.title')} />} scroll>
      <View style={styles.content}>
        <Text variant="body" color="textMuted">
          {t('floatRequest.intro')}
        </Text>
        {list.data ? (
          <Card>
            <InfoRow label={t('floatRequest.current')} value={money(list.data.float)} />
            <InfoRow label={t('floatRequest.max')} value={money(list.data.max_float)} last />
          </Card>
        ) : null}
        {message ? <Banner tone={message.tone}>{message.text}</Banner> : null}
        {pending ? (
          <Card style={{ gap: space.sm }}>
            <Text variant="bodyStrong">
              {pending.code} · {money(pending.amount)}
            </Text>
            <Text variant="caption" color="textMuted">
              {t('floatRequest.status.pending')} · {formatDateTime(pending.created_at)}
            </Text>
            {!pending.has_proof ? <Button variant="secondary" label={t('floatRequest.addProof')} onPress={() => void addProof(pending)} disabled={busy} /> : null}
            <Button variant="danger" label={t('floatRequest.cancel')} onPress={() => void run(() => endpoints.cancelFloatRequest(pending.id), t('floatRequest.status.cancelled'))} disabled={busy} />
          </Card>
        ) : (
          <>
            <Text variant="label">{t('floatRequest.amount')}</Text>
            <MoneyInput value={amount} onChange={setAmount} testID="float-amount" />
            <Text variant="caption" color={amount > room ? 'danger' : 'textMuted'}>
              {t('floatRequest.room', { amount: money(room) })}
            </Text>
            <Text variant="label">{t('floatRequest.reason')}</Text>
            <TextInput value={reason} onChangeText={setReason} style={input} maxLength={280} />
            <Text variant="label">{t('floatRequest.reference')}</Text>
            <TextInput value={reference} onChangeText={setReference} style={input} maxLength={120} placeholder="BGFI 88231" placeholderTextColor={colors.textMuted} />
            <Button
              label={t('floatRequest.send')}
              disabled={!amount || amount > room || reason.trim().length < 3}
              loading={busy}
              onPress={() => void run(async () => {
                const sent = await endpoints.requestFloat({ amount, reason: reason.trim(), payment_reference: reference.trim() });
                setAmount(0);
                return sent;
              }, (sent) => t('floatRequest.sent', { code: sent.code }))}
              testID="float-send"
            />
          </>
        )}

        <Text variant="title">{t('floatRequest.history')}</Text>
        {list.data && list.data.requests.length === 0 ? <EmptyState message={t('floatRequest.empty')} /> : null}
        {list.data?.requests.map((r) => (
          <Card key={r.id} style={{ gap: 2 }}>
            <View style={styles.row}>
              <Text variant="bodyStrong">{money(r.amount)}</Text>
              <Text variant="label" color={r.status === 'approved' ? 'success' : r.status === 'rejected' ? 'danger' : 'textMuted'}>
                {t(`floatRequest.status.${r.status}`)}
              </Text>
            </View>
            <Text variant="caption" color="textMuted">
              {r.code} · {formatDateTime(r.created_at)}
            </Text>
            {r.decision_note ? <Text variant="caption">{r.decision_note}</Text> : null}
          </Card>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.md, paddingTop: space.sm, paddingBottom: space.xl },
  input: { minHeight: 52, borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: space.lg, fontSize: 17 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }
});
