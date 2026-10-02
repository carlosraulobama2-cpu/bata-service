import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../api/endpoints';
import type { AgentProfile } from '../../api/types';
import { Banner } from '../../components/Banner';
import { Button } from '../../components/Button';
import { Chips } from '../../components/Chips';
import { Header } from '../../components/Header';
import { ResultView } from '../../components/ResultView';
import { Screen } from '../../components/Screen';
import { Text } from '../../components/Text';
import { errorMessage } from '../../features/errors';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, space } from '../../theme/tokens';

/** The cities the agents API accepts (velynt/api-agente/agent_routes/account.py CITIES). */
const CITIES =['Malabo', 'Bata', 'Ebebiyín', 'Mongomo', 'Luba', 'Evinayong', 'Aconibe', 'Añisok', 'Mbini', 'Cogo', 'Riaba', 'Nsok-Nsomo', 'Micomeseng', 'Niefang', 'Annobón'] as const;

/**
 * Ask to become a Velynt agent: shop name, city and address. Velynt reviews it in the control
 * panel; the account needs a verified identity in the Velynt app first.
 */
export default function ApplyScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const qc = useQueryClient();
  const [business, setBusiness] = useState('');
  const [city, setCity] = useState<string>('Malabo');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<AgentProfile | null>(null);
  const close = () => (router.canGoBack() ? router.back() : router.replace('/home'));

  const valid = business.trim().length >= 3 && address.trim().length >= 5;
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      setSent(await endpoints.apply({ business_name: business.trim(), city, address: address.trim() }));
      void qc.invalidateQueries({ queryKey: ['me'] });
    } catch (err) {
      setError(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <Screen header={<Header leading="close" onLeading={close} />} footer={<Button label={t('common.done')} onPress={close} testID="apply-done" />}>
        <ResultView tone="success" title={t('apply.sentTitle')} instruction={t('apply.pending', { code: sent.code })} />
      </Screen>
    );
  }

  const input = [styles.input, { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border }];
  return (
    <Screen
      header={<Header leading="close" onLeading={close} title={t('apply.title')} />}
      footer={<Button label={t('apply.send')} onPress={() => void submit()} disabled={!valid} loading={busy} testID="apply-send" />}
      scroll
    >
      <View style={styles.content}>
        <Text variant="body" color="textMuted">
          {t('apply.intro')}
        </Text>
        <Text variant="label">{t('apply.business')}</Text>
        <TextInput value={business} onChangeText={setBusiness} placeholder={t('apply.businessPlaceholder')} placeholderTextColor={colors.textMuted} style={input} maxLength={120} testID="apply-business" />
        <Text variant="label">{t('apply.city')}</Text>
        <Chips value={city} onChange={setCity} options={CITIES.map((c) => ({ value: c, label: c }))} />
        <Text variant="label">{t('apply.address')}</Text>
        <TextInput value={address} onChangeText={setAddress} placeholder={t('apply.addressPlaceholder')} placeholderTextColor={colors.textMuted} style={input} maxLength={200} testID="apply-address" />
        {error ? <Banner tone="danger">{error}</Banner> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { gap: space.md, paddingTop: space.sm },
  input: { height: 56, borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: space.lg, fontSize: 17 }
});
