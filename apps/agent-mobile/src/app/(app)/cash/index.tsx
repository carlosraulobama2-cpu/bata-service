import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../../api/endpoints';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { Header } from '../../../components/Header';
import { InfoRow } from '../../../components/InfoRow';
import { MoneyInput } from '../../../components/MoneyInput';
import { Screen } from '../../../components/Screen';
import { Text } from '../../../components/Text';
import { errorMessage } from '../../../features/errors';
import { useTheme } from '../../../theme/ThemeProvider';
import { radius, space } from '../../../theme/tokens';
import { formatDateTime, money } from '../../../utils/format';

/** "Efectivo disponible": the agent counts the till; Velynt says what it expected since the last count. */
export default function CashScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const cash = useQuery({ queryKey: ['cash'], queryFn: endpoints.cash });
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: 'success' | 'warning' | 'danger'; text: string } | null>(null);
  const close = () => (router.canGoBack() ? router.back() : router.replace('/home'));
  const c = cash.data;

  const save = async () => {
    setBusy(true);
    setResult(null);
    try {
      const counted = await endpoints.countCash(amount, note.trim());
      const d = counted.difference;
      setResult(
        d === null
          ? { tone: 'success', text: t('cash.first') }
          : d === 0
            ? { tone: 'success', text: t('cash.ok') }
            : d > 0
              ? { tone: 'warning', text: t('cash.over', { amount: money(d) }) }
              : { tone: 'danger', text: t('cash.short', { amount: money(-d) }) }
      );
      setAmount(0);
      setNote('');
      qc.setQueryData(['cash'], counted.position);
      void qc.invalidateQueries({ queryKey: ['me'] });
    } catch (err) {
      setResult({ tone: 'danger', text: errorMessage(err, t) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen header={<Header leading="close" onLeading={close} title={t('cash.title')} />} scroll>
      <View style={styles.content}>
        <Text variant="body" color="textMuted">
          {t('cash.intro')}
        </Text>
        <Card>
          {c && c.declared !== null ? (
            <>
              <InfoRow label={t('cash.declared')} value={`${money(c.declared)} · ${formatDateTime(c.declared_at!)}`} />
              <InfoRow label={t('cash.expected')} value={money(c.expected ?? c.declared)} strong last />
              <Text variant="caption" color="textMuted" style={{ marginTop: space.sm }}>
                {t('cash.since', { in: money(c.cash_in_since), out: money(c.cash_out_since) })}
              </Text>
            </>
          ) : (
            <Text variant="body" color="textMuted">
              {t('cash.never')}
            </Text>
          )}
        </Card>
        {result ? <Banner tone={result.tone}>{result.text}</Banner> : null}
        <Text variant="title">{t('cash.count')}</Text>
        <Text variant="label">{t('cash.amount')}</Text>
        <MoneyInput value={amount} onChange={setAmount} testID="cash-amount" />
        <Text variant="label">{t('cash.note')}</Text>
        <TextInput value={note} onChangeText={setNote} maxLength={280} style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]} />
        <Button label={t('cash.save')} onPress={() => void save()} loading={busy} testID="cash-save" />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.md, paddingTop: space.sm, paddingBottom: space.xl },
  input: { minHeight: 52, borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: space.lg, fontSize: 17 }
});
