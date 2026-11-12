import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, StyleSheet, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../../api/endpoints';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { Header } from '../../../components/Header';
import { InfoRow } from '../../../components/InfoRow';
import { MoneyInput } from '../../../components/MoneyInput';
import { Screen } from '../../../components/Screen';
import { ErrorState, Skeleton } from '../../../components/States';
import { Text } from '../../../components/Text';
import { errorMessage } from '../../../features/errors';
import { useTheme } from '../../../theme/ThemeProvider';
import { radius, space } from '../../../theme/tokens';
import { formatDateTime, formatTime, money } from '../../../utils/format';

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
  const day = useQuery({ queryKey: ['cash-close'], queryFn: endpoints.cashClose });
  const closed = day.data?.closed ?? null;
  const [closing, setClosing] = useState(false);

  // End of the day: the same count, kept as the day's close (once a day). A big difference alerts Velynt.
  const closeDay = async () => {
    const sure = `¿Cerrar el día con ${money(amount)} en caja? Solo se puede cerrar una vez al día.`;
    if (Platform.OS === 'web' ? !window.confirm(sure) : !(await new Promise<boolean>((resolve) => Alert.alert('Cerrar el día', sure, [{ text: t('common.cancel'), style: 'cancel', onPress: () => resolve(false) }, { text: 'Cerrar el día', onPress: () => resolve(true) }])))) return;
    setClosing(true);
    setResult(null);
    try {
      const done = await endpoints.closeDay(amount, note.trim());
      const d = done.difference_minor;
      setResult(
        // null: no earlier count to compare with, so there is nothing that "cuadra" yet.
        d === null
          ? { tone: 'success', text: 'Día cerrado. Es tu primer recuento: desde ahora Velynt comparará cada cierre con lo que cobres y pagues.' }
          : d === 0
          ? { tone: 'success', text: 'Día cerrado. La caja cuadra.' }
          : { tone: done.mismatch_alert ? 'danger' : 'warning', text: `Día cerrado con una diferencia de ${money(d)}.${done.mismatch_alert ? ' Velynt lo revisará.' : ''}` }
      );
      setAmount(0);
      setNote('');
      await Promise.all([qc.invalidateQueries({ queryKey: ['cash'] }), qc.invalidateQueries({ queryKey: ['cash-close'] }), qc.invalidateQueries({ queryKey: ['me'] })]);
    } catch (err) {
      setResult({ tone: 'danger', text: errorMessage(err, t) });
    } finally {
      setClosing(false);
    }
  };

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
        {cash.error ? <ErrorState error={cash.error} onRetry={() => cash.refetch()} /> : null}
        {/* Only say "never counted" when the server said so, not while loading or after an error. */}
        {cash.isLoading ? <Skeleton height={96} /> : !c ? null : (
        <Card>
          {c.declared !== null ? (
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
        )}
        {result ? <Banner tone={result.tone}>{result.text}</Banner> : null}
        <Text variant="title">{t('cash.count')}</Text>
        <Text variant="label">{t('cash.amount')}</Text>
        <MoneyInput value={amount} onChange={setAmount} testID="cash-amount" />
        <Text variant="label">{t('cash.note')}</Text>
        <TextInput value={note} onChangeText={setNote} maxLength={280} style={[styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }]} />
        <Button label={t('cash.save')} onPress={() => void save()} loading={busy} disabled={closing} testID="cash-save" />

        <Text variant="title" style={{ marginTop: space.lg }}>
          Cierre del día
        </Text>
        {day.data ? (
          <Card>
            <InfoRow label={`Depósitos (${day.data.cash_in.count})`} value={`+${money(day.data.cash_in.volume_minor)}`} />
            <InfoRow label={`Retiros (${day.data.cash_out.count})`} value={`−${money(day.data.cash_out.volume_minor)}`} />
            <InfoRow label="Efectivo ganado hoy en caja" value={money(day.data.net_cash_minor)} strong />
            <InfoRow label="Tus ganancias de hoy" value={money(day.data.commission_minor)} last />
          </Card>
        ) : day.error ? (
          <ErrorState error={day.error} onRetry={() => day.refetch()} />
        ) : (
          <Skeleton height={120} />
        )}
        {closed ? (
          <Banner tone={closed.difference_minor ? 'warning' : 'success'}>
            {`Día cerrado a las ${formatTime(closed.closed_at)} con ${money(closed.counted_minor)} en caja${closed.difference_minor ? ` (diferencia ${money(closed.difference_minor)})` : ''}.`}
          </Banner>
        ) : day.data ? (
          <>
            <Text variant="caption" color="textMuted">
              Al terminar el día, cuenta la caja, escribe el total arriba y ciérralo. Velynt guarda el cierre y revisa las diferencias grandes.
            </Text>
            <Button variant="secondary" label="Cerrar el día con este recuento" onPress={() => void closeDay()} loading={closing} disabled={busy} testID="cash-close-day" />
          </>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.md, paddingTop: space.sm, paddingBottom: space.xl },
  input: { fontFamily: 'Outfit_400Regular', minHeight: 52, borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: space.lg, fontSize: 17 }
});
