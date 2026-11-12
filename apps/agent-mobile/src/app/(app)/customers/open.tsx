import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Check } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { endpoints } from '../../../api/endpoints';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { Header } from '../../../components/Header';
import { ResultView } from '../../../components/ResultView';
import { Screen } from '../../../components/Screen';
import { Text } from '../../../components/Text';
import { errorMessage } from '../../../features/errors';
import { useTheme } from '../../../theme/ThemeProvider';
import { radius, space } from '../../../theme/tokens';

type Field = 'name' | 'phone' | 'pin';
type Opened = { name: string; customer_id: string; phone_number: string };

/**
 * "Abrir cuenta a un cliente": for someone without Velynt, at the counter. The customer types their own 4 numbers
 * (their password and payment PIN) and accepts the terms; then they sign in to the Velynt app with the phone.
 */
export default function OpenCustomerScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState<Field | null>(null);
  const [opened, setOpened] = useState<Opened | null>(null);

  // Guinea numbers have 9 digits; "240" typed in front is the country code, already shown.
  const national = phone.replace(/\D/g, '').replace(/^240(?=\d{9}$)/, '');
  const valid = name.trim().length >= 2 && national.length === 9 && /^\d{4}$/.test(pin) && accepted;
  const missing =
    name.trim().length < 2
      ? 'Escribe el nombre y apellidos del cliente.'
      : national.length !== 9
        ? 'El teléfono debe tener 9 números, por ejemplo 222 123 456.'
        : !/^\d{4}$/.test(pin)
          ? 'Elige 4 números para la contraseña del cliente.'
          : !accepted
            ? 'El cliente tiene que aceptar los Términos y la Política de privacidad.'
            : null;
  const close = () => (router.canGoBack() ? router.back() : router.replace('/home'));
  const reset = () => {
    setName('');
    setPhone('');
    setPin('');
    setAccepted(false);
    setError(null);
    setOpened(null);
  };
  const submit = async () => {
    if (busy) return;
    if (!valid) return setError(missing);
    setBusy(true);
    setError(null);
    try {
      const res = await endpoints.openCustomer({ name: name.trim(), phone_number: `+240${national}`, pin, accept_terms: true });
      setPin('');
      setOpened(res.customer);
      void queryClient.invalidateQueries({ queryKey: ['customers'] });
    } catch (err) {
      setError(errorMessage(err, t));
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  if (opened) {
    return (
      <Screen
        header={<Header leading="close" onLeading={close} title={t('openCustomer.title')} />}
        footer={
          <View style={{ gap: space.sm }}>
            <Button label={t('openCustomer.another')} onPress={reset} testID="open-customer-another" />
            <Button variant="ghost" label={t('common.goHome')} onPress={() => router.replace('/home')} />
          </View>
        }
        scroll
      >
        <ResultView tone="success" title={t('openCustomer.doneTitle')} instruction={t('openCustomer.doneBody', { name: opened.name, id: opened.customer_id })} />
      </Screen>
    );
  }

  const inputStyle = (field: Field) => [
    styles.input,
    { color: colors.text, backgroundColor: colors.surface, borderColor: focused === field ? colors.primary : colors.border },
  ];
  return (
    <Screen
      header={<Header leading="close" onLeading={close} title={t('openCustomer.title')} />}
      footer={<Button label={t('openCustomer.submit')} onPress={() => void submit()} loading={busy} style={valid ? undefined : { opacity: 0.6 }} testID="open-customer-submit" />}
      scroll
    >
      <Text variant="body" color="textMuted" style={{ marginBottom: space.lg }}>
        {t('openCustomer.intro')}
      </Text>
      <View style={styles.field}>
        <Text variant="label">{t('openCustomer.nameLabel')}</Text>
        <TextInput value={name} onChangeText={setName} onFocus={() => setFocused('name')} onBlur={() => setFocused(null)} autoCapitalize="words" style={inputStyle('name')} testID="open-customer-name" />
      </View>
      <View style={styles.field}>
        <Text variant="label">{t('openCustomer.phoneLabel')}</Text>
        <View style={styles.phoneRow}>
          <Text variant="bodyStrong">+240</Text>
          <TextInput
            value={phone}
            onChangeText={(v) => setPhone(v.replace(/[^\d ]/g, '').slice(0, 15))}
            onFocus={() => setFocused('phone')}
            onBlur={() => setFocused(null)}
            keyboardType="phone-pad"
            placeholder="222 000 000"
            placeholderTextColor={colors.textMuted}
            style={[inputStyle('phone'), { flex: 1 }]}
            testID="open-customer-phone"
          />
        </View>
      </View>
      <View style={styles.field}>
        <Text variant="label">{t('openCustomer.pinLabel')}</Text>
        <TextInput
          value={pin}
          onChangeText={(v) => setPin(v.replace(/\D/g, '').slice(0, 4))}
          onFocus={() => setFocused('pin')}
          onBlur={() => setFocused(null)}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={4}
          placeholder="••••"
          placeholderTextColor={colors.textMuted}
          style={[inputStyle('pin'), styles.pin]}
          testID="open-customer-pin"
        />
        <Text variant="caption" color="textMuted">
          {t('openCustomer.pinHint')}
        </Text>
      </View>
      <Pressable style={styles.check} onPress={() => setAccepted((v) => !v)} accessibilityRole="checkbox" accessibilityState={{ checked: accepted }} testID="open-customer-terms">
        <View style={[styles.box, { borderColor: accepted ? colors.primary : colors.border, backgroundColor: accepted ? colors.primary : colors.surface }]}>
          {accepted ? <Check size={14} color={colors.onPrimary} /> : null}
        </View>
        <Text variant="body" style={{ flex: 1 }}>
          {t('openCustomer.terms')}
        </Text>
      </Pressable>
      <View style={{ flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap' }}>
        <Button variant="ghost" label={t('legal.terms')} onPress={() => router.push('/legal/terms')} />
        <Button variant="ghost" label={t('legal.privacy')} onPress={() => router.push('/legal/privacy')} />
      </View>
      {error ? <Banner tone="danger">{error}</Banner> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  field: { gap: space.sm, marginBottom: space.lg },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  input: { height: 56, borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: space.lg, fontSize: 17 },
  pin: { fontFamily: 'Outfit_400Regular', letterSpacing: 12, fontSize: 22, width: 160 },
  check: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.sm, marginBottom: space.lg },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});
